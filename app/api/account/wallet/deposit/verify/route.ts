import { NextResponse } from "next/server";
import { getCurrentUser, createSupabaseAdminClient } from "../../../../../../lib/supabase/server";
import { verifyPaystack } from "../../../../../../lib/payments/paystack";
import { clientIp, consumeRateLimits, limiterUnavailable, rateLimited, rulesFor } from "../../../../../../lib/security/rate-limit";
import { recordDepositCheck } from "../../../../../../lib/wallet/settle-pending";
import { formatError } from "../../../../../../lib/errors/format-error";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try { const rl = await consumeRateLimits(rulesFor("wallet-deposit-verify", user.id, clientIp(request), [10, 30])); if (!rl.allowed) return rateLimited(rl); } catch { return limiterUnavailable(); }
  if (Number(request.headers.get("content-length") || 0) > 4096) return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  const reference = body && typeof body === "object" && typeof (body as Record<string, unknown>).reference === "string" ? (body as Record<string, string>).reference.trim() : "";
  if (!reference) return NextResponse.json({ error: "reference is required." }, { status: 400 });
  try {
    const admin = createSupabaseAdminClient();
    const { data: deposit, error } = await admin.from("wallet_deposit_payments").select("id,user_id,amount_minor,currency,provider_reference,status,provider_response,is_reconciled").eq("reference", reference).maybeSingle();
    if (error) throw error;
    if (!deposit || deposit.user_id !== user.id) return NextResponse.json({ error: "Deposit not found." }, { status: 404 });

    const pResp = (deposit.provider_response && typeof deposit.provider_response === "object" ? deposit.provider_response : {}) as Record<string, any>;
    if (pResp.reconciled === true || deposit.is_reconciled === true) {
      await recordDepositCheck({
        depositId: deposit.id,
        reference,
        status: "SKIPPED_RECONCILED",
        gatewayResponse: "Deposit is marked as reconciled; skipping credit.",
        rawResponse: { reconciled: true },
        checkedBy: user.id,
      });
      return NextResponse.json({
        status: "RECONCILED",
        reference,
        message: "Deposit was already compensated manually and marked as reconciled.",
      });
    }

    if (deposit.status === "PAID" && deposit.provider_reference) return NextResponse.json({ status: "PAID", reference });
    const verified = await verifyPaystack(reference);
    const tx = verified.data || {};
    const providerReference = String(tx.reference || "");
    const amount = String(tx.amount || "");
    const currency = String(tx.currency || "");
    const paystackStatus = String(tx.status || "");
    const gatewayResponse = String(tx.gateway_response || "");
    const paidAt = typeof tx.paid_at === "string" ? tx.paid_at : null;

    await recordDepositCheck({
      depositId: deposit.id,
      reference,
      status: paystackStatus === "success" ? "VERIFIED_SUCCESS" : "VERIFIED_NON_SUCCESS",
      paystackStatus,
      amountMinor: BigInt(deposit.amount_minor),
      currency: String(deposit.currency),
      paidAt,
      gatewayResponse,
      rawResponse: tx,
      checkedBy: user.id,
    });

    if (tx.status !== "success") return NextResponse.json({ status: "PENDING", reference });
    if (providerReference !== reference || amount !== String(deposit.amount_minor) || currency !== "GHS") return NextResponse.json({ status: "FAILED", reference }, { status: 400 });
    const { data: credited, error: creditError } = await admin.rpc("credit_wallet_deposit", { p_deposit_id: deposit.id, p_user_id: user.id, p_provider_reference: providerReference, p_amount_minor: BigInt(deposit.amount_minor).toString(), p_currency: "GHS" });
    if (creditError) {
      if (creditError.message?.includes("DEPOSIT_RECONCILED")) {
        await recordDepositCheck({
          depositId: deposit.id,
          reference,
          status: "SKIPPED_RECONCILED",
          gatewayResponse: "credit_wallet_deposit refused reconciled deposit in verify",
          rawResponse: { error: creditError.message },
          checkedBy: user.id,
        });
        return NextResponse.json({
          status: "RECONCILED",
          reference,
          message: "Deposit was already compensated manually and marked as reconciled.",
        });
      }
      throw creditError;
    }
    return NextResponse.json({ status: "PAID", reference, transaction_id: credited?.id ?? null });
  } catch (error) {
    const formatted = formatError(error);
    console.error("Wallet deposit verification failed:", formatted);
    return NextResponse.json({ error: "Unable to verify wallet deposit." }, { status: 502 });
  }
}
