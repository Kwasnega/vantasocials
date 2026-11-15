import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../../lib/admin/auth";
import { executeOrderRefund } from "../../../../../../lib/orders/refund-service";
import { consumeRateLimits, rulesFor, clientIp, rateLimited, limiterUnavailable } from "../../../../../../lib/security/rate-limit";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { admin } = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: orderId } = await params;
  if (!orderId) {
    return NextResponse.json({ error: "Order ID is required" }, { status: 400 });
  }

  // Rate limiting (max 30 admin refund requests per minute)
  try {
    const rl = await consumeRateLimits(rulesFor("admin-refund", admin.id, clientIp(request), [30, 60]));
    if (!rl.allowed) return rateLimited(rl);
  } catch {
    return limiterUnavailable();
  }

  try {
    const body = await request.json();
    const reason = typeof body.reason === "string" && body.reason.trim().length > 0
      ? body.reason.trim()
      : "Admin manual refund";
    const forceAmbiguous = Boolean(body.forceAmbiguous);

    const result = await executeOrderRefund({
      orderId,
      refundedBy: `admin:${admin.id}`,
      reason,
      forceAmbiguous,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[API] Admin refund error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
