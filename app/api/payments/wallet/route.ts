import { after, NextResponse } from "next/server";
import { createSupabaseAdminClient, getCurrentUser } from "../../../../lib/supabase/server";
import { clientIp, consumeRateLimits, limiterUnavailable, rateLimited, rulesFor } from "../../../../lib/security/rate-limit";
import { assertPayableOrderTotal } from "../../../../lib/pricing/customer-price";
import { validateConfiguredOrderTarget } from "../../../../lib/targets/contracts";
import { captureServerEvent } from "../../../../lib/posthog/server";
import { dispatchPaidOrder } from "../../../../lib/fulfillment/dispatch-paid-order";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try { const rl = await consumeRateLimits(rulesFor("payments-wallet", user.id, clientIp(request), [3, 10])); if (!rl.allowed) return rateLimited(rl); } catch { return limiterUnavailable(); }
  if (Number(request.headers.get("content-length") || 0) > 4096) return NextResponse.json({ error: "Request body is too large." }, { status: 413 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  const orderId = body && typeof body === "object" && typeof (body as Record<string, unknown>).order_id === "string"
    ? (body as Record<string, string>).order_id.trim()
    : "";
  if (!orderId) return NextResponse.json({ error: "order_id is required." }, { status: 400 });

  try {
    const admin = createSupabaseAdminClient();
    const { data: order, error: orderError } = await admin.from("orders")
      .select("id,public_order_id,user_id,status,payment_status,fulfillment_status,total,currency,target_type,target_value,input_schema_snapshot,input_values,services(target_type,platforms(slug))")
      .eq("public_order_id", orderId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    try {
      assertPayableOrderTotal(order.total);
    } catch (validationError) {
      return NextResponse.json({ error: validationError instanceof Error ? validationError.message : "Order total is not payable." }, { status: 409 });
    }
    if (order.currency !== "GHS") return NextResponse.json({ error: "Wallet payments require GHS orders." }, { status: 409 });
    if (order.fulfillment_status !== "NOT_STARTED") return NextResponse.json({ error: "Order is not available for wallet payment." }, { status: 409 });
    if (order.payment_status === "PAID") return NextResponse.json(order);
    if (order.status !== "PENDING_PAYMENT" || order.payment_status !== "UNPAID") return NextResponse.json({ error: "Order is not available for wallet payment." }, { status: 409 });
    const service = Array.isArray(order.services) ? order.services[0] : order.services;
    const rawPlatform = service?.platforms;
    const platform = Array.isArray(rawPlatform) ? rawPlatform[0] : rawPlatform;
    if (!service || service.target_type !== order.target_type) {
      return NextResponse.json({ error: "The service target configuration changed. Please create a new order or contact support." }, { status: 409 });
    }
    const targetValidation = validateConfiguredOrderTarget({
      platformSlug: platform?.slug,
      targetType: order.target_type,
      targetValue: order.target_value,
      inputSchemaSnapshot: order.input_schema_snapshot,
      inputValues: order.input_values,
    });
    if (!targetValidation.valid) return NextResponse.json({ error: targetValidation.reason }, { status: 409 });

    const reference = `wallet-order:${order.id}`;
    const { data: debit, error: debitError } = await admin.rpc("debit_wallet_for_order", { p_order_id: order.id, p_reference: reference });
    if (debitError) {
      if (debitError.code === "P0001" && debitError.message === "INSUFFICIENT_FUNDS") return NextResponse.json({ error: "Insufficient wallet balance." }, { status: 402 });
      if (debitError.code === "22023" || debitError.code === "P0002" || debitError.code === "42501") return NextResponse.json({ error: debitError.message }, { status: 409 });
      throw debitError;
    }

    after(() => captureServerEvent(user.id, "wallet_payment_completed", {
      total: order.total,
      currency: order.currency,
    }));
    after(async () => {
      try {
        const dispatch = await dispatchPaidOrder(order.id);
        console.info(JSON.stringify({ event: "paid_order_fulfillment_dispatch", orderId: order.id, outcome: dispatch.outcome }));
      } catch {
        console.error(JSON.stringify({ event: "paid_order_fulfillment_dispatch_failed", orderId: order.id }));
      }
    });
    return NextResponse.json({
      order: {
        public_order_id: order.public_order_id,
        payment_status: "PAID",
      },
      debit_id: debit?.id ?? null,
    });
  } catch (error) {
    console.error("Wallet order payment failed", error instanceof Error ? JSON.stringify({ name: error.name, message: error.message, stack: error.stack }) : JSON.stringify(error));
    return NextResponse.json({ error: "Unable to pay order from wallet." }, { status: 502 });
  }
}
