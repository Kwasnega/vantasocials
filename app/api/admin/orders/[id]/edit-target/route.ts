import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../../lib/admin/auth";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../../../lib/security/rate-limit";
import { executeTargetEditAndRetry } from "../../../../../../lib/orders/target-fix/service";

/**
 * POST /api/admin/orders/[id]/edit-target
 * Allows an admin to edit the target URL/username on an invalid_target failed order and retry fulfillment.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const rejected = await enforceAdminRateLimit(request, user.id, "order-target-edit", 10);
    if (rejected) return rejected;
  } catch {
    return limiterUnavailable();
  }

  const { id: orderId } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const newTarget = typeof body.newTarget === "string" ? body.newTarget.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!newTarget) {
    return NextResponse.json({ error: "New target is required." }, { status: 400 });
  }

  const result = await executeTargetEditAndRetry({
    orderId,
    rawNewTarget: newTarget,
    editedBy: `admin:${user.id}`,
    reason: reason || "Admin corrected target link",
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    message: result.message,
    newCanonical: result.newCanonical,
    retryResult: result.retryResult,
  });
}
