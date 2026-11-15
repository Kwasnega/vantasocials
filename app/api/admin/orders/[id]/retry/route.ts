import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../../lib/admin/auth";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../../../lib/security/rate-limit";
import { retryOrderFulfillment, recoverStuckSubmittingOrders } from "../../../../../../lib/fulfillment/retry-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const rejected = await enforceAdminRateLimit(request, user.id, "order-retry", 20);
    if (rejected) return rejected;
  } catch {
    return limiterUnavailable();
  }

  const { id: orderId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
    return NextResponse.json({ error: "Invalid order ID format." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const force = Boolean(body.force);

  // Run stuck-submitting recovery pass opportunistically
  await recoverStuckSubmittingOrders().catch(() => 0);

  const result = await retryOrderFulfillment({
    orderId,
    adminUserId: user.id,
    force,
  });

  return NextResponse.json(result);
}
