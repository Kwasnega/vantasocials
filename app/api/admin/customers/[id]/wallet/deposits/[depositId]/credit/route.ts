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

  // 1. Fetch deposit
  const { data: deposit, error: depErr } = await db
    .from("wallet_deposit_payments")
    .select("id,user_id,wallet_id,reference,provider_reference,amount_minor,currency,status,provider_response,is_reconciled")
    .eq("id", depositId)
    .eq("user_id", customerId)
    .maybeSingle();

  if (depErr || !deposit) {
    return NextResponse.json({ error: "Deposit not found" }, { status: 404 });
  }

  // Check if already reconciled
  const pResponse =
    deposit.provider_response && typeof deposit.provider_response === "object"
      ? (deposit.provider_response as Record<string, any>)
      : {};

  if (pResponse.reconciled === true || deposit.is_reconciled === true) {
    return NextResponse.json(
      { error: "Deposit is already marked as reconciled. It cannot be credited to prevent double-compensation." },
      { status: 409 }
    );
  }

  if (deposit.status === "PAID") {
    return NextResponse.json({ error: "Deposit is already credited and marked as PAID." }, { status: 409 });
  }

  // 2. Paystack verification check
  const paystackKey = process.env.PAYSTACK_SECRET_KEY;
  if (!paystackKey) {
    return NextResponse.json({ error: "Paystack secret key is missing" }, { status: 500 });
  }

  let verifyData: any = null;
  try {
    const paystackRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(deposit.reference)}`,
      {
        headers: {
          Authorization: `Bearer ${paystackKey}`,
          "Content-Type": "application/json",
        },
      }
    );
    verifyData = await paystackRes.json();
  } catch (err) {
    return NextResponse.json(
      { error: "Could not reach Paystack API: " + (err instanceof Error ? err.message : String(err)) },
      { status: 502 }
    );
  }

  const tx = verifyData?.data;
  if (tx?.status !== "success") {
    return NextResponse.json(
      {
        error: `Paystack does not report SUCCESS for this deposit (Status: ${tx?.status || verifyData?.code || "NOT_SUCCESS"}). Wallet cannot be credited.`,
      },
      { status: 400 }
    );
  }

  // 3. Amount and currency check
  if (String(tx.amount) !== String(deposit.amount_minor) || String(tx.currency).toUpperCase() !== "GHS") {
    return NextResponse.json(
      {
        error: `Amount or currency mismatch: Paystack=${tx.currency} ${tx.amount}, Deposit=${deposit.currency} ${deposit.amount_minor}. Crediting blocked.`,
      },
      { status: 400 }
    );
  }

  // 4. Call idempotent credit_wallet_deposit stored procedure
  const providerReference = String(tx.reference || deposit.reference);
  const { data: credited, error: creditError } = await db.rpc("credit_wallet_deposit", {
    p_deposit_id: deposit.id,
    p_user_id: customerId,
    p_provider_reference: providerReference,
    p_amount_minor: String(deposit.amount_minor),
    p_currency: "GHS",
  });

  if (creditError) {
    if (creditError.message?.includes("DEPOSIT_RECONCILED")) {
      return NextResponse.json(
        { error: "Deposit is marked as reconciled. Crediting refused by database protection." },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: `Database credit RPC failed: ${creditError.message}` },
      { status: 500 }
    );
  }

  // 5. Update provider_response and log action
  const checkedAt = new Date().toISOString();
  await db
    .from("wallet_deposit_payments")
    .update({
      provider_response: {
        ...pResponse,
        credited_by_admin: admin.id,
        credited_at: checkedAt,
      },
      updated_at: checkedAt,
    })
    .eq("id", deposit.id);

  await db.from("admin_action_log").insert({
    action: "WALLET_DEPOSIT_RECONCILED_CREDIT",
    performed_by: admin.id,
    performed_at: checkedAt,
    details: {
      deposit_id: deposit.id,
      customer_id: customerId,
      reference: deposit.reference,
      amount_minor: deposit.amount_minor,
      currency: "GHS",
      credited_transaction_id: credited?.id ?? null,
    },
  });

  return NextResponse.json({
    success: true,
    message: "Wallet credited successfully.",
    transaction_id: credited?.id ?? null,
  });
}
