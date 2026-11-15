import { NextRequest, NextResponse } from "next/server";
import { clientIp, consumeRateLimits, rateLimited, rulesFor } from "../../../../lib/security/rate-limit";
import { executeTargetEditAndRetry, validateCustomerFixToken } from "../../../../lib/orders/target-fix/service";

/**
 * POST /api/orders/fix-target
 * Customer endpoint for submitting corrected link using single-use token.
 * Rate limited per IP.
 */
export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const rateLimitRules = rulesFor("customer-fix-target", null, ip, [10, 60]);
  const rateLimitResult = await consumeRateLimits(rateLimitRules);
  if (!rateLimitResult.allowed) {
    return rateLimited(rateLimitResult);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const newTarget = typeof body.newTarget === "string" ? body.newTarget.trim() : "";

  if (!token || !newTarget) {
    return NextResponse.json({ error: "Token and new link are required." }, { status: 400 });
  }

  // 1. Validate token first
  const validation = await validateCustomerFixToken(token);
  if (!validation.valid || !validation.order) {
    return NextResponse.json(
      { error: "This link is invalid, already used, or expired." },
      { status: 400 }
    );
  }

  // 2. Execute target edit and trigger atomic retry
  const result = await executeTargetEditAndRetry({
    orderId: validation.order.id,
    rawNewTarget: newTarget,
    editedBy: "customer",
    rawToken: token,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    message: "Thank you, we're delivering your order now.",
    newCanonical: result.newCanonical,
  });
}
