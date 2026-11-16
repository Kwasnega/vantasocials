import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";
import { verifyPaystack } from "../../../../../lib/payments/paystack";
import { recordDepositCheck } from "../../../../../lib/wallet/settle-pending";
import { formatError } from "../../../../../lib/errors/format-error";

export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization");
  if (!expected || supplied !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Dry-run mode by default unless explicitly configured via query param dry_run=false
  const { searchParams } = new URL(request.url);
  const isDryRun = searchParams.get("dry_run") !== "false";

  const admin = createSupabaseAdminClient();
  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  // Find deposits in non-final status older than 30 minutes
  const { data: deposits, error } = await admin
    .from("wallet_deposit_payments")
    .select("id,user_id,wallet_id,reference,amount_minor,currency,status,created_at,provider_response,is_reconciled")
    .not("status", "in", '("PAID","FAILED","ABANDONED")')
    .lt("created_at", thirtyMinsAgo)
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<{
    id: string;
    reference: string;
    user_id: string;
    our_status: string;
    paystack_status: string | null;
    action_taken: string;
  }> = [];

  for (const dep of deposits ?? []) {
    const pResp = (dep.provider_response && typeof dep.provider_response === "object" ? dep.provider_response : {}) as Record<string, any>;

    // Skip reconciled deposits (already compensated)
    if (pResp.reconciled === true || dep.is_reconciled === true) {
      results.push({
        id: dep.id,
        reference: dep.reference,
        user_id: dep.user_id,
        our_status: dep.status,
        paystack_status: pResp.last_check?.paystack_status ?? null,
        action_taken: "SKIPPED_ALREADY_RECONCILED",
      });
      continue;
    }

    try {
      const verified = await verifyPaystack(dep.reference);
      const tx = verified.data || {};
      const paystackStatus = tx.status ? String(tx.status).toUpperCase() : "UNKNOWN";

      // Update last check in provider_response
      const updatedPResp = {
        ...pResp,
        last_check: {
          checked_at: new Date().toISOString(),
          checked_by: "system_reconcile_cron",
          paystack_status: paystackStatus,
          amount: tx.amount ?? null,
          currency: tx.currency ?? null,
          paid_at: tx.paid_at ?? null,
          gateway_response: tx.gateway_response ?? null,
        },
      };

      await recordDepositCheck({
        depositId: dep.id,
        reference: dep.reference,
        status: isDryRun ? "RECONCILE_DRY_RUN_CHECK" : "RECONCILE_JOB_CHECK",
        paystackStatus,
        amountMinor: BigInt(dep.amount_minor),
        currency: String(dep.currency),
        paidAt: typeof tx.paid_at === "string" ? tx.paid_at : null,
        gatewayResponse: typeof tx.gateway_response === "string" ? tx.gateway_response : null,
        rawResponse: tx,
        checkedBy: null,
      });

      if (
        tx.status === "success" &&
        String(tx.reference || "") === dep.reference &&
        String(tx.amount || "") === String(dep.amount_minor) &&
        String(tx.currency || "").toUpperCase() === "GHS"
      ) {
        if (isDryRun) {
          results.push({
            id: dep.id,
            reference: dep.reference,
            user_id: dep.user_id,
            our_status: dep.status,
            paystack_status: paystackStatus,
            action_taken: "DRY_RUN_ELIGIBLE_FOR_CREDIT",
          });
        } else {
          // Idempotent settlement call
          const { error: creditError } = await admin.rpc("credit_wallet_deposit", {
            p_deposit_id: dep.id,
            p_user_id: dep.user_id,
            p_provider_reference: dep.reference,
            p_amount_minor: String(dep.amount_minor),
            p_currency: "GHS",
          });
          if (creditError) {
            if (creditError.message?.includes("DEPOSIT_RECONCILED")) {
              await recordDepositCheck({
                depositId: dep.id,
                reference: dep.reference,
                status: "SKIPPED_RECONCILED",
                gatewayResponse: "credit_wallet_deposit refused reconciled deposit in cron reconcile",
                rawResponse: { error: creditError.message },
              });
              results.push({
                id: dep.id,
                reference: dep.reference,
                user_id: dep.user_id,
                our_status: dep.status,
                paystack_status: paystackStatus,
                action_taken: "SKIPPED_ALREADY_RECONCILED",
              });
              continue;
            }
            throw creditError;
          }

          results.push({
            id: dep.id,
            reference: dep.reference,
            user_id: dep.user_id,
            our_status: "PAID",
            paystack_status: paystackStatus,
            action_taken: "CREDITED_WALLET",
          });
        }
      } else {
        results.push({
          id: dep.id,
          reference: dep.reference,
          user_id: dep.user_id,
          our_status: dep.status,
          paystack_status: paystackStatus,
          action_taken: `NO_CREDIT_${paystackStatus}`,
        });
      }

      // Small pacing delay
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch (err) {
      const formatted = formatError(err);
      results.push({
        id: dep.id,
        reference: dep.reference,
        user_id: dep.user_id,
        our_status: dep.status,
        paystack_status: null,
        action_taken: `ERROR: ${formatted}`,
      });
      await recordDepositCheck({
        depositId: dep.id,
        reference: dep.reference,
        status: "RECONCILE_VERIFY_ERROR",
        gatewayResponse: formatted,
        rawResponse: { error: formatted },
      });
    }
  }

  return NextResponse.json({
    dry_run: isDryRun,
    processed_count: results.length,
    results,
  });
}
