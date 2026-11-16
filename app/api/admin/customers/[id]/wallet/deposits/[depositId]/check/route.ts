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
  const paystackKey = process.env.PAYSTACK_SECRET_KEY;
  if (!paystackKey) {
    return NextResponse.json({ error: "Paystack secret key is not configured" }, { status: 500 });
  }

  const db = createSupabaseAdminClient();

  // 1. Fetch deposit
  const { data: deposit, error: depErr } = await db
    .from("wallet_deposit_payments")
    .select("id,user_id,wallet_id,reference,provider_reference,amount_minor,currency,status,provider_response")
    .eq("id", depositId)
    .eq("user_id", customerId)
    .maybeSingle();

  if (depErr || !deposit) {
    return NextResponse.json({ error: "Deposit not found" }, { status: 404 });
  }

  // 2. Call Paystack verify endpoint read-only
  let paystackResult: {
    status: boolean;
    message?: string;
    data?: {
      status?: string;
      reference?: string;
      amount?: number;
      currency?: string;
      paid_at?: string;
      gateway_response?: string;
    };
    code?: string;
  };

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
    paystackResult = await paystackRes.json();
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to communicate with Paystack API: " + (err instanceof Error ? err.message : String(err)) },
      { status: 502 }
    );
  }

  const txData = paystackResult.data;
  const paystackStatus = txData?.status
    ? txData.status.toUpperCase()
    : paystackResult.status === false
    ? (paystackResult.code === "transaction_not_found" ? "NOT_FOUND" : "FAILED")
    : "UNKNOWN";

  const checkedAt = new Date().toISOString();
  const existingResponse =
    deposit.provider_response && typeof deposit.provider_response === "object"
      ? deposit.provider_response
      : {};

  const updatedResponse = {
    ...existingResponse,
    last_check: {
      checked_at: checkedAt,
      checked_by: admin.id,
      paystack_status: paystackStatus,
      amount: txData?.amount ?? null,
      currency: txData?.currency ?? null,
      paid_at: txData?.paid_at ?? null,
      gateway_response: txData?.gateway_response ?? paystackResult.message ?? null,
      raw: paystackResult,
    },
  };

  // 3. Update deposit's provider_response with check result
  await db
    .from("wallet_deposit_payments")
    .update({
      provider_response: updatedResponse,
      updated_at: checkedAt,
    })
    .eq("id", deposit.id);

  // Also log into admin_action_log
  await db.from("admin_action_log").insert({
    action: "DEPOSIT_CHECK_PAYSTACK",
    performed_by: admin.id,
    performed_at: checkedAt,
    details: {
      deposit_id: deposit.id,
      customer_id: customerId,
      reference: deposit.reference,
      paystack_status: paystackStatus,
      paid_at: txData?.paid_at ?? null,
      amount: txData?.amount ?? null,
    },
  });

  return NextResponse.json({
    success: true,
    reference: deposit.reference,
    our_status: deposit.status,
    paystack_status: paystackStatus,
    amount_minor: txData?.amount ?? null,
    currency: txData?.currency ?? null,
    paid_at: txData?.paid_at ?? null,
    gateway_response: txData?.gateway_response ?? paystackResult.message ?? null,
    checked_at: checkedAt,
  });
}
