import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../../../../../lib/supabase/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; depositId: string }> }
) {
  const { admin } = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: customerId, depositId } = await params;
  const db = createSupabaseAdminClient();

  let body: { note?: string; linked_transaction_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const note = (body?.note || "").trim();
  const linkedTxId = (body?.linked_transaction_id || "").trim();

  if (!note) {
    return NextResponse.json({ error: "A note explaining the reconciliation is required." }, { status: 400 });
  }

  // 1. Fetch deposit
  const { data: deposit, error: depErr } = await db
    .from("wallet_deposit_payments")
    .select("id,user_id,reference,amount_minor,currency,status,provider_response")
    .eq("id", depositId)
    .eq("user_id", customerId)
    .maybeSingle();

  if (depErr || !deposit) {
    return NextResponse.json({ error: "Deposit not found" }, { status: 404 });
  }

  const pResponse =
    deposit.provider_response && typeof deposit.provider_response === "object"
      ? (deposit.provider_response as Record<string, any>)
      : {};

  if (pResponse.reconciled === true) {
    return NextResponse.json({ error: "Deposit is already reconciled." }, { status: 409 });
  }

  // Optional: check linked transaction exists
  let linkedTxSummary: any = null;
  if (linkedTxId) {
    const { data: tx } = await db
      .from("wallet_transactions")
      .select("id,type,direction,amount_minor,currency,reference")
      .eq("id", linkedTxId)
      .maybeSingle();
    if (tx) {
      linkedTxSummary = tx;
    }
  }

  const reconciledAt = new Date().toISOString();
  const updatedResponse = {
    ...pResponse,
    reconciled: true,
    reconciled_at: reconciledAt,
    reconciled_by: admin.id,
    reconciliation_note: note,
    linked_transaction_id: linkedTxId || null,
    linked_transaction_summary: linkedTxSummary,
  };

  // 2. Mark as reconciled in provider_response WITHOUT crediting wallet
  const { error: updateErr } = await db
    .from("wallet_deposit_payments")
    .update({
      provider_response: updatedResponse,
      updated_at: reconciledAt,
    })
    .eq("id", deposit.id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // 3. Log audit action
  await db.from("admin_action_log").insert({
    action: "WALLET_DEPOSIT_MARKED_RECONCILED",
    performed_by: admin.id,
    performed_at: reconciledAt,
    details: {
      deposit_id: deposit.id,
      customer_id: customerId,
      reference: deposit.reference,
      note,
      linked_transaction_id: linkedTxId || null,
    },
  });

  return NextResponse.json({
    success: true,
    message: "Deposit marked as reconciled (already compensated). Double-crediting is now locked.",
  });
}
