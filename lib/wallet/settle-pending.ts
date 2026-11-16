import "server-only";
import { createSupabaseAdminClient } from "../supabase/server";
import { verifyPaystack, PaystackApiError } from "../payments/paystack";
import { formatError } from "../errors/format-error";
import { consumeRateLimits } from "../security/rate-limit";

export type SettleDepositsResult = {
  checkedCount: number;
  creditedCount: number;
  totalCreditedMinor: bigint;
  creditedDeposits: Array<{
    id: string;
    reference: string;
    amountMinor: bigint;
  }>;
};

/**
 * Audit-log a check attempt into public.deposit_checks using the admin client.
 */
export async function recordDepositCheck(params: {
  depositId: string;
  reference: string;
  status: string;
  paystackStatus?: string | null;
  amountMinor?: bigint | null;
  currency?: string | null;
  paidAt?: string | null;
  gatewayResponse?: string | null;
  rawResponse?: Record<string, unknown>;
  checkedBy?: string | null;
}): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    await admin.from("deposit_checks").insert({
      deposit_id: params.depositId,
      reference: params.reference,
      status: params.status,
      paystack_status: params.paystackStatus ?? null,
      amount_minor: params.amountMinor ? params.amountMinor.toString() : null,
      currency: params.currency ?? null,
      paid_at: params.paidAt ?? null,
      gateway_response: params.gatewayResponse ? params.gatewayResponse.slice(0, 500) : null,
      raw_response: params.rawResponse ?? {},
      checked_by: params.checkedBy ?? null,
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Failed to record deposit check:", formatError(err));
  }
}

/**
 * Self-heal: inspects this user's AUTHORIZED or PENDING deposits created in the last 24h (up to 5),
 * verifies each with Paystack (using the production secret key), and credits via credit_wallet_deposit
 * if verified successfully and not already reconciled.
 *
 * Rate-limited to at most once per 60 seconds per user.
 */
export async function settlePendingDeposits(userId: string): Promise<SettleDepositsResult> {
  const emptyResult: SettleDepositsResult = {
    checkedCount: 0,
    creditedCount: 0,
    totalCreditedMinor: 0n,
    creditedDeposits: [],
  };

  if (!userId) return emptyResult;

  // DB-backed per-user rate limit (1 request per 60 seconds)
  try {
    const rateLimit = await consumeRateLimits([
      { key: `user:${userId}:settle_deposits`, limit: 1, windowSeconds: 60 },
    ]);
    if (!rateLimit.allowed) {
      return emptyResult;
    }
  } catch (rlErr) {
    console.warn("Rate limit check failed for settlePendingDeposits:", formatError(rlErr));
    // If rate limiter DB call fails, we allow proceed or return emptyResult; safe fallback is proceed or throttle.
  }

  const now = Date.now();
  const admin = createSupabaseAdminClient();
  const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  // Find non-final deposits for this user
  const { data: deposits, error } = await admin
    .from("wallet_deposit_payments")
    .select("id, user_id, amount_minor, currency, reference, status, provider_response, is_reconciled")
    .eq("user_id", userId)
    .in("status", ["AUTHORIZED", "PENDING", "INITIALIZING"])
    .gte("created_at", twentyFourHoursAgo)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error || !deposits || deposits.length === 0) {
    if (error) console.error("Error fetching pending deposits for self-heal:", formatError(error));
    return emptyResult;
  }

  let creditedCount = 0;
  let totalCreditedMinor = 0n;
  const creditedDeposits: SettleDepositsResult["creditedDeposits"] = [];

  for (const deposit of deposits) {
    // Guardrail: Skip if already marked reconciled
    const pResp = (deposit.provider_response && typeof deposit.provider_response === "object"
      ? deposit.provider_response
      : {}) as Record<string, unknown>;

    if (deposit.is_reconciled === true || pResp.reconciled === true) {
      await recordDepositCheck({
        depositId: deposit.id,
        reference: deposit.reference,
        status: "SKIPPED_RECONCILED",
        gatewayResponse: "Deposit is marked as reconciled; skipping credit.",
        rawResponse: { reconciled: true },
        checkedBy: userId,
      });
      continue;
    }

    try {
      const verified = await verifyPaystack(deposit.reference);
      const tx = (verified.data || {}) as Record<string, unknown>;
      const paystackStatus = String(tx.status || "unknown");
      const providerRef = String(tx.reference || "");
      const txAmount = String(tx.amount || "");
      const txCurrency = String(tx.currency || "");
      const gatewayResponse = String(tx.gateway_response || "");
      const paidAt = typeof tx.paid_at === "string" ? tx.paid_at : null;

      await recordDepositCheck({
        depositId: deposit.id,
        reference: deposit.reference,
        status: paystackStatus === "success" ? "VERIFIED_SUCCESS" : "VERIFIED_NON_SUCCESS",
        paystackStatus,
        amountMinor: BigInt(deposit.amount_minor),
        currency: String(deposit.currency),
        paidAt,
        gatewayResponse,
        rawResponse: tx,
        checkedBy: userId,
      });

      if (paystackStatus === "success" && providerRef === deposit.reference && txAmount === String(deposit.amount_minor)) {
        // Safe to credit
        const { error: creditError } = await admin.rpc("credit_wallet_deposit", {
          p_deposit_id: deposit.id,
          p_user_id: userId,
          p_provider_reference: providerRef,
          p_amount_minor: BigInt(deposit.amount_minor).toString(),
          p_currency: deposit.currency,
        });

        if (creditError) {
          console.error(`Failed to credit deposit ${deposit.id} during self-heal:`, formatError(creditError));
          if (creditError.message?.includes("DEPOSIT_RECONCILED")) {
            await recordDepositCheck({
              depositId: deposit.id,
              reference: deposit.reference,
              status: "SKIPPED_RECONCILED",
              gatewayResponse: "credit_wallet_deposit refused reconciled deposit in settlePendingDeposits",
              rawResponse: { error: creditError.message },
              checkedBy: userId,
            });
          }
        } else {
          creditedCount++;
          const amount = BigInt(deposit.amount_minor);
          totalCreditedMinor += amount;
          creditedDeposits.push({
            id: deposit.id,
            reference: deposit.reference,
            amountMinor: amount,
          });
        }
      }
    } catch (verifyErr) {
      const formatted = formatError(verifyErr);
      console.error(`Failed to verify deposit ${deposit.reference}:`, formatted);
      await recordDepositCheck({
        depositId: deposit.id,
        reference: deposit.reference,
        status: "VERIFY_ERROR",
        gatewayResponse: formatted,
        rawResponse: { error: formatted },
        checkedBy: userId,
      });
    }
  }

  return {
    checkedCount: deposits.length,
    creditedCount,
    totalCreditedMinor,
    creditedDeposits,
  };
}
