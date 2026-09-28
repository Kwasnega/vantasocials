import { NextResponse } from "next/server";
import { createSupabaseAdminClient, getCurrentUser } from "../../../lib/supabase/server";

const MAX_TARGET_LENGTH = 2048;

function validTarget(targetType: string, value: string) {
  if (!value || value.length > MAX_TARGET_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) return false;
  if (["url", "post_url", "video_url"].includes(targetType)) {
    try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; }
  }
  return true;
}

function decimalToScaled(value: string, scale = 6) {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new Error("Invalid rate");
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0").slice(0, scale));
}

function formatMoney(value: bigint) {
  const whole = value / 100n;
  const cents = (value % 100n).toString().padStart(2, "0");
  return `${whole}.${cents}`;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid order request." }, { status: 400 });
  const input = body as Record<string, unknown>;
  const serviceId = typeof input.service_id === "string" ? input.service_id : "";
  const targetValue = typeof input.target_value === "string" ? input.target_value.trim() : "";
  const quantity = input.quantity;
  if (!serviceId || typeof quantity !== "number" || !Number.isSafeInteger(quantity) || !targetValue) return NextResponse.json({ error: "service_id, target_value, and integer quantity are required." }, { status: 400 });

  try {
    const admin = createSupabaseAdminClient();
    const { data: service, error: serviceError } = await admin.from("services").select("id,platform_id,target_type,min_quantity,max_quantity,selling_rate,currency,active").eq("id", serviceId).maybeSingle();
    if (serviceError) throw serviceError;
    if (!service) return NextResponse.json({ error: "Service not found." }, { status: 404 });
    if (!service.active) return NextResponse.json({ error: "Service is not available." }, { status: 409 });
    const { data: platform, error: platformError } = await admin.from("platforms").select("id,active").eq("id", service.platform_id).maybeSingle();
    if (platformError) throw platformError;
    if (!platform || !platform.active) return NextResponse.json({ error: "Service is not available." }, { status: 409 });
    if (!validTarget(service.target_type, targetValue)) return NextResponse.json({ error: "Target is invalid for this service." }, { status: 400 });
    if (quantity <= 0 || quantity < service.min_quantity || quantity > service.max_quantity) return NextResponse.json({ error: `Quantity must be between ${service.min_quantity} and ${service.max_quantity}.` }, { status: 400 });

    // Existing catalog semantics are provisional price-per-unit: rate × quantity, rounded to GHS cents.
    const unitScaled = decimalToScaled(String(service.selling_rate));
    const subtotalCents = (unitScaled * BigInt(quantity) + 5000n) / 10000n;
    const subtotal = formatMoney(subtotalCents);
    const { data: order, error: orderError } = await admin.from("orders").insert({ user_id: user.id, service_id: service.id, target_type: service.target_type, target_value: targetValue, quantity, unit_price: String(service.selling_rate), subtotal, total: subtotal, currency: service.currency, status: "PENDING_PAYMENT", payment_status: "UNPAID", fulfillment_status: "NOT_STARTED" }).select("id,public_order_id,status,payment_status,fulfillment_status,service_id,target_type,target_value,quantity,unit_price,subtotal,total,currency,created_at").single();
    if (orderError) throw orderError;
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    console.error("Order creation failed", error);
    return NextResponse.json({ error: "Unable to create order." }, { status: 500 });
  }
}
