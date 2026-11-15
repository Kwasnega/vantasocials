import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin/auth";
import { executeOrderRefund, type ProcessRefundResult } from "../../../../../lib/orders/refund-service";
import { consumeRateLimits, rulesFor, clientIp, rateLimited, limiterUnavailable } from "../../../../../lib/security/rate-limit";

export async function POST(request: NextRequest) {
  const { admin } = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limiting
  try {
    const rl = await consumeRateLimits(rulesFor("admin-bulk-refund", admin.id, clientIp(request), [10, 60]));
    if (!rl.allowed) return rateLimited(rl);
  } catch {
    return limiterUnavailable();
  }

  try {
    const body = await request.json();
    const orderIds: string[] = Array.isArray(body.orderIds) ? body.orderIds : [];
    const reason = typeof body.reason === "string" && body.reason.trim().length > 0
      ? body.reason.trim()
      : "Bulk admin refund";
    const forceAmbiguous = Boolean(body.forceAmbiguous);

    if (orderIds.length === 0) {
      return NextResponse.json({ error: "No order IDs provided" }, { status: 400 });
    }

    if (orderIds.length > 50) {
      return NextResponse.json({ error: "Maximum 50 orders can be bulk refunded at once" }, { status: 400 });
    }

    const results: ProcessRefundResult[] = [];
    let refundedCount = 0;
    let skippedCount = 0;
    let totalRefundedAmount = 0;

    for (const orderId of orderIds) {
      const result = await executeOrderRefund({
        orderId,
        refundedBy: `admin:${admin.id}`,
        reason,
        forceAmbiguous,
      });

      results.push(result);
      if (result.ok && !result.alreadyRefunded) {
        refundedCount++;
        totalRefundedAmount += result.amountRefunded || 0;
      } else {
        skippedCount++;
      }
    }

    return NextResponse.json({
      total: orderIds.length,
      refundedCount,
      skippedCount,
      totalRefundedAmount,
      results,
    });
  } catch (error) {
    console.error("[API] Admin bulk refund error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
