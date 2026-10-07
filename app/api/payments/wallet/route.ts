import { NextResponse } from "next/server";
import { createSupabaseAdminClient, getCurrentUser } from "../../../../lib/supabase/server";
import { clientIp, consumeRateLimits, limiterUnavailable, rateLimited, rulesFor } from "../../../../lib/security/rate-limit";

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
      .select("id,public_order_id,user_id,status,payment_status,fulfillment_status,total,currency")
      .eq("public_order_id", orderId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    if (order.currency !== "GHS") return NextResponse.json({ error: "Wallet payments require GHS orders." }, { status: 409 });
    if (order.fulfillment_status !== "NOT_STARTED") return NextResponse.json({ error: "Order is not available for wallet payment." }, { status: 409 });
    if (order.payment_status === "PAID") return NextResponse.json(order);
    if (order.status !== "PENDING_PAYMENT" || order.payment_status !== "UNPAID") return NextResponse.json({ error: "Order is not available for wallet payment." }, { status: 409 });

    const reference = `wallet-order:${order.id}`;
    const { data: debit, error: debitError } = await admin.rpc("debit_wallet_for_order", { p_order_id: order.id, p_reference: reference });
    if (debitError) {
      if (debitError.code === "P0001" && debitError.message === "INSUFFICIENT_FUNDS") return NextResponse.json({ error: "Insufficient wallet balance." }, { status: 402 });
      if (debitError.code === "22023" || debitError.code === "P0002" || debitError.code === "42501") return NextResponse.json({ error: debitError.message }, { status: 409 });
      throw debitError;
    }

    const { data: paidOrder, error: paidOrderError } = await admin.from("orders")
      .select("id,public_order_id,status,payment_status,fulfillment_status,total,currency")
      .eq("id", order.id)
      .single();
    if (paidOrderError) throw paidOrderError;
    return NextResponse.json({ order: paidOrder, debit_id: debit?.id ?? null });
  } catch (error) {
    console.error("Wallet order payment failed", error instanceof Error ? JSON.stringify({ name: error.name, message: error.message, stack: error.stack }) : JSON.stringify(error));
    return NextResponse.json({ error: "Unable to pay order from wallet." }, { status: 502 });
  }
}
