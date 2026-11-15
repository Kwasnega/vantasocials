import { NextRequest, NextResponse } from "next/server";
import { runBalanceMonitor } from "../../../../../lib/provider-balance/monitor";

/**
 * POST /api/internal/balance/monitor
 *
 * Cron-triggered endpoint that checks the ReliableSMM balance and updates
 * provider_health with alert status.
 *
 * Auth: Bearer ${CRON_SECRET}  (same pattern as /api/internal/fulfillment/cron)
 * Schedule: every 15 minutes via vercel.json crons
 */
export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization");
  if (!expected || supplied !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runBalanceMonitor();
    return NextResponse.json({
      status: result.status,
      balance: result.balance,
      currency: result.currency,
      alertStatus: result.alertStatus,
      runwayDays: result.runwayDays,
      consecutiveFailures: result.consecutiveFailures,
      ...(result.error ? { error: result.error } : {}),
    });
  } catch (err) {
    console.error("[/api/internal/balance/monitor] Uncaught error:", err);
    return NextResponse.json({ error: "Balance monitor failed unexpectedly." }, { status: 500 });
  }
}
