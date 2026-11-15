import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";
import { executeOrderRefund } from "../../../../../lib/orders/refund-service";
import { getRefundEligibility } from "../../../../../lib/orders/refund-eligibility";

/**
 * Scheduled auto-refund background endpoint.
 * Authenticated via Bearer CRON_SECRET.
 *
 * Rules:
 * 1. auto_refund_enabled must be true in app_settings.
 * 2. Only processes orders passing getRefundEligibility without any admin override (no ambiguous orders).
 * 3. Order must have been failed for at least auto_refund_after_hours (default 72h).
 * 4. Respects hard per-run cap (auto_refund_max_per_run, default 50).
 * 5. Respects 24-hour total refund cap (auto_refund_daily_cap_ghs, default 500 GHS).
 *    If cap is hit, stops and alerts.
 */
export async function GET(request: NextRequest) {
  return handleAutoRefund(request);
}

export async function POST(request: NextRequest) {
  return handleAutoRefund(request);
}

async function handleAutoRefund(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createSupabaseAdminClient();

  try {
    // 1. Fetch settings from app_settings
    const { data: settingsRows } = await db
      .from("app_settings")
      .select("key,value")
      .in("key", [
        "auto_refund_enabled",
        "auto_refund_after_hours",
        "auto_refund_max_per_run",
        "auto_refund_daily_cap_ghs",
      ]);

    const settingsMap = new Map<string, unknown>();
    settingsRows?.forEach((row) => settingsMap.set(row.key, row.value));

    const enabled = Boolean(settingsMap.get("auto_refund_enabled") ?? false);
    if (!enabled) {
      return NextResponse.json({
        status: "skipped",
        reason: "auto_refund_enabled is false",
      });
    }

    const afterHours = Math.max(24, Number(settingsMap.get("auto_refund_after_hours") ?? 72));
    const maxPerRun = Math.max(1, Math.min(100, Number(settingsMap.get("auto_refund_max_per_run") ?? 50)));
    const dailyCapGhs = Math.max(0, Number(settingsMap.get("auto_refund_daily_cap_ghs") ?? 500));

    // 2. Check 24-hour refund sum to enforce daily cap
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentRefunds } = await db
      .from("orders")
      .select("refund_amount")
      .eq("refund_status", "REFUNDED")
      .gte("refunded_at", twentyFourHoursAgo);

    const past24hTotal = (recentRefunds || []).reduce((acc, curr) => acc + Number(curr.refund_amount || 0), 0);

    if (past24hTotal >= dailyCapGhs) {
      console.warn(`[AutoRefund] Daily refund cap hit: GHS ${past24hTotal.toFixed(2)} >= ${dailyCapGhs}. Halting auto-refund.`);
      return NextResponse.json({
        status: "halted_cap_reached",
        past24hTotal,
        dailyCapGhs,
      });
    }

    // 3. Find candidates:
    // - payment_status = 'PAID'
    // - refund_status = 'NONE'
    // - fulfillment_status = 'FAILED'
    // - failed_at <= now() - afterHours
    // - target_fix_status <> 'AWAITING_CUSTOMER'
    const cutoffDate = new Date(Date.now() - afterHours * 60 * 60 * 1000).toISOString();

    const { data: candidateOrders, error: candidatesErr } = await db
      .from("orders")
      .select(`
        id,
        public_order_id,
        payment_status,
        fulfillment_status,
        failure_reason,
        refund_status,
        target_fix_status,
        total,
        currency,
        failed_at,
        created_at
      `)
      .eq("payment_status", "PAID")
      .eq("refund_status", "NONE")
      .eq("fulfillment_status", "FAILED")
      .neq("target_fix_status", "AWAITING_CUSTOMER")
      .or(`failed_at.lte.${cutoffDate},and(failed_at.is.null,created_at.lte.${cutoffDate})`)
      .order("created_at", { ascending: true })
      .limit(maxPerRun * 2);

    if (candidatesErr) {
      throw candidatesErr;
    }

    let processedCount = 0;
    let refundedCount = 0;
    let currentBatchTotal = 0;
    const results = [];

    for (const order of candidateOrders || []) {
      if (refundedCount >= maxPerRun) break;
      if (past24hTotal + currentBatchTotal >= dailyCapGhs) {
        console.warn(`[AutoRefund] Daily cap reached during run at GHS ${currentBatchTotal}. Stopping.`);
        break;
      }

      // Check provider orders
      const { data: latestPo } = await db
        .from("provider_orders")
        .select("id,provider_order_id,attempt_status")
        .eq("order_id", order.id)
        .order("attempt_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      const eligibility = getRefundEligibility({
        id: order.id,
        payment_status: order.payment_status,
        fulfillment_status: order.fulfillment_status,
        failure_reason: order.failure_reason,
        refund_status: order.refund_status,
        target_fix_status: order.target_fix_status,
        total: order.total,
        currency: order.currency,
        provider_order_id: latestPo?.provider_order_id ?? null,
        latest_attempt_status: latestPo?.attempt_status ?? null,
      });

      // ONLY process if strictly eligible without any confirmation/ambiguity override
      if (eligibility.eligible && !eligibility.requiresConfirmation) {
        processedCount++;
        const res = await executeOrderRefund({
          orderId: order.id,
          refundedBy: "system:auto_refund",
          reason: `Automatic refund after ${afterHours}h failed threshold`,
          forceAmbiguous: false,
        });

        results.push(res);
        if (res.ok && !res.alreadyRefunded) {
          refundedCount++;
          currentBatchTotal += res.amountRefunded || 0;
        }
      }
    }

    return NextResponse.json({
      status: "completed",
      candidatesFound: candidateOrders?.length ?? 0,
      processedCount,
      refundedCount,
      batchRefundTotalGhs: currentBatchTotal,
      past24hTotalGhs: past24hTotal + currentBatchTotal,
      results,
    });
  } catch (error) {
    console.error("[AutoRefund] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
