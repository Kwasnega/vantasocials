import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../../lib/admin/auth";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../../../lib/security/rate-limit";
import { createAndSendFixToken } from "../../../../../../lib/orders/target-fix/service";

/**
 * POST /api/admin/orders/[id]/ask-fix
 * Admin action to generate a single-use token and email the customer to fix their target URL.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const rejected = await enforceAdminRateLimit(request, user.id, "order-ask-fix", 5);
    if (rejected) return rejected;
  } catch {
    return limiterUnavailable();
  }

  const { id: orderId } = await params;
  const result = await createAndSendFixToken({
    orderId,
    adminUserId: user.id,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    message: result.message,
    fixUrl: result.fixUrl,
  });
}
