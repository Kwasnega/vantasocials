import { after, NextResponse } from "next/server";
import { createSupabaseAdminClient, getCurrentUser } from "../../../../lib/supabase/server";
import { initializePaystack, verifyPaystack } from "../../../../lib/payments/paystack";
import { initializeBundleUpGatewayAttempt } from "../../../../lib/payments/bundleup-gateway-attempt";
import { verifyAndSettlePaystack } from "../../../../lib/payments/settle";
import { assertPayableOrderTotal } from "../../../../lib/pricing/customer-price";
import { validateConfiguredOrderTarget } from "../../../../lib/targets/contracts";
import { clientIp, consumeRateLimits, limiterUnavailable, rateLimited, rulesFor } from "../../../../lib/security/rate-limit";
import { captureServerEvent } from "../../../../lib/posthog/server";
import { flushPostHogLogs, logPostHogInfo } from "../../../../lib/posthog/logs";

type PaymentProvider = "paystack" | "bundleup_gateway";
const PAYSTACK_CHECKOUT_HOSTS = ["checkout.paystack.com"];
const PAYMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getCheckoutAuthorizationResponse(
  authorizationUrl: unknown,
  reference: string,
  provider: PaymentProvider,
  paymentId?: string,
) {
  if (typeof authorizationUrl !== "string" || authorizationUrl.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(authorizationUrl);
  } catch {
    return null;
  }
  const configuredHosts = provider === "bundleup_gateway"
    ? (process.env.VANTA_BUNDLEUP_GATEWAY_CHECKOUT_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean)
    : PAYSTACK_CHECKOUT_HOSTS;
  const allowedHosts = new Set(configuredHosts);
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.hash
    || url.port
    || url.toString() !== authorizationUrl
    || !allowedHosts.has(url.hostname)
  ) {
    return null;
  }
  return NextResponse.json({
    authorization_url: authorizationUrl,
    reference,
    provider,
    allowed_checkout_hosts: [...allowedHosts],
    ...(paymentId ? { payment_id: paymentId } : {}),
  });
}

function isActivePaymentAttemptConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "23505"
    || (typeof candidate.message === "string"
      && candidate.message.includes("ANOTHER_PAYMENT_ATTEMPT_ACTIVE"));
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try { const rl = await consumeRateLimits(rulesFor("payments-initialize", user.id, clientIp(request), [3, 10])); if (!rl.allowed) return rateLimited(rl); } catch { return limiterUnavailable(); }
  if (Number(request.headers.get("content-length") || 0) > 4096) return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  const orderId = body && typeof body === "object" && typeof (body as Record<string, unknown>).order_id === "string" ? (body as Record<string, string>).order_id.trim() : "";
  if (!orderId) return NextResponse.json({ error: "order_id is required." }, { status: 400 });

  try {
    const admin = createSupabaseAdminClient();
    const { data: order, error } = await admin.from("orders").select("id,public_order_id,total,currency,status,payment_status,user_id,target_type,target_value,input_schema_snapshot,input_values,services(target_type,platforms(slug))").eq("public_order_id", orderId).eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    try {
      assertPayableOrderTotal(order.total);
    } catch (validationError) {
      return NextResponse.json({ error: validationError instanceof Error ? validationError.message : "Order total is not payable." }, { status: 409 });
    }
    if (order.status !== "PENDING_PAYMENT" || order.payment_status !== "UNPAID") return NextResponse.json({ error: "Order is not available for payment." }, { status: 409 });
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
    if (!targetValidation.valid) {
      return NextResponse.json({ error: targetValidation.reason }, { status: 409 });
    }

    const selectedProvider = process.env.VANTA_CHECKOUT_PAYMENT_PROVIDER ?? "paystack";
    if (selectedProvider !== "paystack" && selectedProvider !== "bundleup_gateway") {
      return NextResponse.json({ error: "Payment provider configuration is invalid." }, { status: 503 });
    }

    if (selectedProvider === "bundleup_gateway") {
      if (process.env.VANTA_BUNDLEUP_GATEWAY_ENABLED !== "true") {
        return NextResponse.json({ error: "The selected payment provider is unavailable." }, { status: 503 });
      }

      try {
        const initialized = await initializeBundleUpGatewayAttempt({
          orderId: order.id,
          userId: user.id,
        });
        if (initialized.status === "initialized") {
          if (
            !PAYMENT_ID_PATTERN.test(initialized.paymentId)
            || typeof initialized.reference !== "string"
            || initialized.reference.length === 0
          ) {
            return NextResponse.json({ error: "Payment authorization could not be validated." }, { status: 502 });
          }
          const response = getCheckoutAuthorizationResponse(
            initialized.authorizationUrl,
            initialized.reference,
            "bundleup_gateway",
            initialized.paymentId,
          );
          if (response) return response;
          return NextResponse.json({ error: "Payment authorization could not be validated." }, { status: 502 });
        }
        if (initialized.status === "rejected" || initialized.status === "failed" || initialized.status === "paid") {
          return NextResponse.json({ error: "This payment attempt cannot be initialized." }, { status: 409 });
        }
        return NextResponse.json({ error: "Payment initialization could not be confirmed. Please retry." }, { status: 502 });
      } catch (error) {
        if (isActivePaymentAttemptConflict(error)) {
          return NextResponse.json(
            { error: "Another payment attempt is already active for this order. Continue with that payment or wait for its status to resolve." },
            { status: 409 },
          );
        }
        throw error;
      }
    }

    const { data: existing, error: existingError } = await admin.from("payments").select("id,reference,provider_response").eq("order_id", order.id).eq("user_id", user.id).eq("provider", "paystack").eq("status", "PENDING").maybeSingle();
    if (existingError) throw existingError;
    let reusablePayment = existing;
    if (reusablePayment?.reference) {
      const pendingPayment = reusablePayment;
      try {
        const verified = await verifyPaystack(pendingPayment.reference);
        const providerStatus = verified.data?.status;
        if (providerStatus === "success") {
          await verifyAndSettlePaystack(pendingPayment.reference, user.id, verified);
          return NextResponse.json({ error: "Payment has already completed." }, { status: 409 });
        }
        if (!["failed", "abandoned", "reversed"].includes(String(providerStatus))) {
          const saved = pendingPayment.provider_response as { authorization_url?: unknown };
          if (typeof saved?.authorization_url === "string") {
            const response = getCheckoutAuthorizationResponse(saved.authorization_url, pendingPayment.reference, "paystack");
            if (response) return response;
            return NextResponse.json({ error: "Saved payment authorization could not be validated." }, { status: 502 });
          }
          return NextResponse.json({ error: "Payment initialization is still in progress." }, { status: 409 });
        }
        await admin.from("payments").update({ status: "FAILED" }).eq("id", pendingPayment.id).eq("status", "PENDING");
        reusablePayment = null;
      } catch {
        const saved = pendingPayment.provider_response as { authorization_url?: unknown };
        if (typeof saved?.authorization_url === "string") {
          const response = getCheckoutAuthorizationResponse(saved.authorization_url, pendingPayment.reference, "paystack");
          if (response) return response;
          return NextResponse.json({ error: "Saved payment authorization could not be validated." }, { status: 502 });
        }
        return NextResponse.json({ error: "Payment initialization is still in progress." }, { status: 409 });
      }
    }

    const reference = reusablePayment?.reference || `VANTA-${order.public_order_id}-${crypto.randomUUID().replaceAll("-", "")}`;
    if (!reusablePayment) {
      const { error: reserveError } = await admin.from("payments").insert({ order_id: order.id, user_id: user.id, provider: "paystack", reference, amount: String(order.total), currency: order.currency, status: "PENDING", provider_response: {} });
      if (reserveError) {
        if (reserveError.code === "23505") return NextResponse.json({ error: "A payment is already being initialized for this order." }, { status: 409 });
        throw reserveError;
      }
    }
    const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const initialized = await initializePaystack({ email: user.email || `${user.id}@invalid.vanta.local`, amount: String(order.total), currency: order.currency, reference, callbackUrl: `${origin}/payments/callback`, orderId: order.id });
    const data = initialized.data || {};
    if (typeof data.authorization_url !== "string" || typeof data.reference !== "string") throw new Error("Paystack returned an invalid authorization response.");
    const authorizationResponse = getCheckoutAuthorizationResponse(data.authorization_url, data.reference, "paystack");
    if (!authorizationResponse) throw new Error("Paystack returned an invalid authorization URL.");
    const { error: updateError } = await admin.from("payments").update({ provider_response: { authorization_url: data.authorization_url, access_code: typeof data.access_code === "string" ? data.access_code : null } }).eq("reference", reference).eq("status", "PENDING");
    if (updateError) throw updateError;
    await captureServerEvent(user.id, "payment_initialized", {
      payment_method: "paystack",
      total: order.total,
      currency: order.currency,
    });
    logPostHogInfo("payment authorization initialized", {
      operation: "payment_initialization",
      outcome: "authorized",
      payment_method: "paystack",
      currency: order.currency,
    });
    after(flushPostHogLogs);
    return authorizationResponse;
  } catch (error) {
    console.error("Payment initialization failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Unable to initialize payment." }, { status: 502 });
  }
}
