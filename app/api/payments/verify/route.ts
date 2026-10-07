import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/supabase/server";
import { verifyAndSettlePaystack } from "../../../../lib/payments/settle";
import { clientIp, consumeRateLimits, limiterUnavailable, rateLimited, rulesFor } from "../../../../lib/security/rate-limit";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try { const rl = await consumeRateLimits(rulesFor("payments-verify", user.id, clientIp(request), [10, 30])); if (!rl.allowed) return rateLimited(rl); } catch { return limiterUnavailable(); }
  if (Number(request.headers.get("content-length") || 0) > 4096) return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  const reference = body && typeof body === "object" && typeof (body as Record<string, unknown>).reference === "string" ? (body as Record<string, string>).reference.trim() : "";
  if (!reference) return NextResponse.json({ error: "reference is required." }, { status: 400 });
  try {
    const result = await verifyAndSettlePaystack(reference, user.id);
    if (!result.found) return NextResponse.json({ error: "Payment not found." }, { status: 404 });
    return NextResponse.json({ paid: result.paid });
  } catch (error) {
    console.error("Payment verification failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Unable to verify payment." }, { status: 502 });
  }
}
