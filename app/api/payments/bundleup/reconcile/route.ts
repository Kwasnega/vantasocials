import { after, NextResponse } from "next/server";
import { getCurrentUser, createSupabaseAdminClient } from "../../../../../lib/supabase/server";
import { reconcileBundleUpGatewayAttempt } from "../../../../../lib/payments/bundleup-gateway-attempt";
import { clientIp, consumeRateLimits, limiterUnavailable, rateLimited, rulesFor } from "../../../../../lib/security/rate-limit";
import { dispatchPaidOrder } from "../../../../../lib/fulfillment/dispatch-paid-order";

const PAYMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reconciliationResponse(
  status: "confirmed" | "pending" | "unconfirmed" | "unresolved",
  retryable: boolean,
) {
  return NextResponse.json({ status, confirmed: status === "confirmed", retryable });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  try {
    const result = await consumeRateLimits(
      rulesFor("payments-bundleup-reconcile", user.id, clientIp(request), [10, 30]),
    );
    if (!result.allowed) return rateLimited(result);
  } catch {
    return limiterUnavailable();
  }

  if (Number(request.headers.get("content-length") || 0) > 4096) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "payment_id is required." }, { status: 400 });
  }
  const fields = body as Record<string, unknown>;
  if (
    Object.keys(fields).length !== 1
    || typeof fields.payment_id !== "string"
    || !PAYMENT_ID_PATTERN.test(fields.payment_id)
  ) {
    return NextResponse.json({ error: "A valid payment_id is required." }, { status: 400 });
  }

  const paymentId = fields.payment_id.toLowerCase();
  try {
    const { data: attempt, error } = await createSupabaseAdminClient()
      .from("payments")
      .select("id,order_id")
      .eq("id", paymentId)
      .eq("user_id", user.id)
      .eq("provider", "bundleup_gateway")
      .maybeSingle();
    if (error) throw error;
    if (!attempt) return NextResponse.json({ error: "Payment attempt not found." }, { status: 404 });

    const result = await reconcileBundleUpGatewayAttempt({ paymentId, userId: user.id });
    if (
      result.status === "already_settled"
      || (result.status === "payment_verified" && (result.settlement === "settled" || result.settlement === "already_settled"))
    ) {
      after(async () => {
        try {
          const dispatch = await dispatchPaidOrder(attempt.order_id);
          console.info(JSON.stringify({ event: "paid_order_fulfillment_dispatch", orderId: attempt.order_id, outcome: dispatch.outcome }));
        } catch {
          console.error(JSON.stringify({ event: "paid_order_fulfillment_dispatch_failed", orderId: attempt.order_id }));
        }
      });
    }
    if (result.status === "already_settled") {
      return reconciliationResponse("confirmed", false);
    }
    if (result.status === "payment_verified") {
      return reconciliationResponse(
        result.settlement === "settled" || result.settlement === "already_settled"
          ? "confirmed"
          : "unresolved",
        result.settlement !== "settled" && result.settlement !== "already_settled",
      );
    }
    if (result.status === "initialized" || result.status === "pending") {
      return reconciliationResponse("pending", true);
    }
    if (result.status === "failed" || result.status === "not_found") {
      return reconciliationResponse("unconfirmed", true);
    }
    return reconciliationResponse("unresolved", true);
  } catch {
    return NextResponse.json(
      { error: "Payment status could not be confirmed. Please retry reconciliation." },
      { status: 503 },
    );
  }
}
