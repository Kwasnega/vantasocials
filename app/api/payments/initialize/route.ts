import { NextResponse } from "next/server";
import { createSupabaseAdminClient, getCurrentUser } from "../../../../lib/supabase/server";
import { initializePaystack, verifyPaystack } from "../../../../lib/payments/paystack";
import { verifyAndSettlePaystack } from "../../../../lib/payments/settle";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  const orderId = body && typeof body === "object" && typeof (body as Record<string, unknown>).order_id === "string" ? (body as Record<string, string>).order_id.trim() : "";
  if (!orderId) return NextResponse.json({ error: "order_id is required." }, { status: 400 });

  try {
    const admin = createSupabaseAdminClient();
    const { data: order, error } = await admin.from("orders").select("id,public_order_id,total,currency,status,payment_status,user_id").eq("public_order_id", orderId).eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    if (order.status !== "PENDING_PAYMENT" || order.payment_status !== "UNPAID") return NextResponse.json({ error: "Order is not available for payment." }, { status: 409 });

    const { data: existing, error: existingError } = await admin.from("payments").select("id,reference,provider_response").eq("order_id", order.id).eq("user_id", user.id).eq("provider", "paystack").eq("status", "PENDING").maybeSingle();
    if (existingError) throw existingError;
    let reusablePayment = existing;
    if (reusablePayment?.reference) {
      const pendingPayment = reusablePayment;
      try {
        const verified = await verifyPaystack(pendingPayment.reference);
        const providerStatus = verified.data?.status;
        if (providerStatus === "success") {
          await verifyAndSettlePaystack(pendingPayment.reference, user.id);
          return NextResponse.json({ error: "Payment has already completed." }, { status: 409 });
        }
        if (!["failed", "abandoned", "reversed"].includes(String(providerStatus))) {
          const saved = pendingPayment.provider_response as { authorization_url?: unknown };
          if (typeof saved?.authorization_url === "string") return NextResponse.json({ authorization_url: saved.authorization_url, reference: pendingPayment.reference });
          return NextResponse.json({ error: "Payment initialization is still in progress." }, { status: 409 });
        }
        await admin.from("payments").update({ status: "FAILED" }).eq("id", pendingPayment.id).eq("status", "PENDING");
        reusablePayment = null;
      } catch {
        const saved = pendingPayment.provider_response as { authorization_url?: unknown };
        if (typeof saved?.authorization_url === "string") return NextResponse.json({ authorization_url: saved.authorization_url, reference: pendingPayment.reference });
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
    const { error: updateError } = await admin.from("payments").update({ provider_response: { authorization_url: data.authorization_url, access_code: typeof data.access_code === "string" ? data.access_code : null } }).eq("reference", reference).eq("status", "PENDING");
    if (updateError) throw updateError;
    return NextResponse.json({ authorization_url: data.authorization_url, reference: data.reference });
  } catch (error) {
    console.error("Payment initialization failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Unable to initialize payment." }, { status: 502 });
  }
}
