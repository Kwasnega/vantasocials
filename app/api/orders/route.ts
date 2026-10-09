import { NextResponse } from "next/server";
import { createSupabaseAdminClient, getCurrentUser } from "../../../lib/supabase/server";
import { validateDynamicOrderInput } from "../../../lib/orders/dynamic-input-validation";
import { normalizeTarget } from "../../../lib/targets/contracts";

const isPlainObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

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
  let normalizedTarget: { valid: true; target: string } | null = null;
  const quantityCandidate = input.quantity;
  const quantity = typeof quantityCandidate === "number" ? quantityCandidate : Number(quantityCandidate);
  if (!serviceId || !Number.isSafeInteger(quantity) || quantity <= 0) return NextResponse.json({ error: "service_id and valid integer quantity are required." }, { status: 400 });

  try {
    const admin = createSupabaseAdminClient();
    const { data: service, error: serviceError } = await admin.from("services").select("id,slug,platform_id,target_type,min_quantity,max_quantity,selling_rate,currency,active").eq("id", serviceId).maybeSingle();
    if (serviceError) throw serviceError;
    if (!service) return NextResponse.json({ error: "Service not found." }, { status: 404 });
    if (!service.active) return NextResponse.json({ error: "Service is not available." }, { status: 409 });

    const { data: platform, error: platformError } = await admin.from("platforms").select("id,active").eq("id", service.platform_id).maybeSingle();
    if (platformError) throw platformError;
    if (!platform || !platform.active) return NextResponse.json({ error: "Service is not available." }, { status: 409 });

    const { count: activeDynamicFieldCount } = await admin.from("service_input_fields").select("id", { count: "exact", head: true }).eq("service_id", service.id).eq("active", true);
    const hasDynamicFields = (activeDynamicFieldCount ?? 0) > 0;

    let dynamicValidation:
      | { schemaVersion: number; schemaSnapshot: unknown[]; validatedValues: Record<string, unknown> }
      | undefined;
    if (hasDynamicFields) {
      const rawDynamicValues = isPlainObject(input.input_values) ? input.input_values : isPlainObject(input.values) ? input.values : null;
      if (!rawDynamicValues) return NextResponse.json({ error: "input_values object is required for this service." }, { status: 400 });
      dynamicValidation = await validateDynamicOrderInput(service.id, rawDynamicValues);
      if (quantity < service.min_quantity || quantity > service.max_quantity) return NextResponse.json({ error: `Quantity must be between ${service.min_quantity} and ${service.max_quantity}.` }, { status: 400 });
    } else {
      if (!targetValue) return NextResponse.json({ error: "target_value and integer quantity are required for legacy services." }, { status: 400 });
      const result = normalizeTarget(service.slug, targetValue);
      if (!result.valid) return NextResponse.json({ error: result.reason }, { status: 400 });
      if (quantity < service.min_quantity || quantity > service.max_quantity) return NextResponse.json({ error: `Quantity must be between ${service.min_quantity} and ${service.max_quantity}.` }, { status: 400 });
      normalizedTarget = result;
    }

    const unitScaled = decimalToScaled(String(service.selling_rate));
    const subtotalCents = (unitScaled * BigInt(quantity) + 5000n) / 10000n;
    const subtotal = formatMoney(subtotalCents);
    const { data: order, error: orderError } = await admin.from("orders").insert({
      user_id: user.id,
      service_id: service.id,
      target_type: service.target_type,
      ...(hasDynamicFields ? { target_value: "dynamic-configured-order" } : { target_value: normalizedTarget!.target }),
      quantity,
      unit_price: String(service.selling_rate),
      subtotal,
      total: subtotal,
      currency: service.currency,
      status: "PENDING_PAYMENT",
      payment_status: "UNPAID",
      fulfillment_status: "NOT_STARTED",
      ...(hasDynamicFields && dynamicValidation ? {
        input_schema_version: dynamicValidation.schemaVersion,
        input_schema_snapshot: dynamicValidation.schemaSnapshot,
        input_values: dynamicValidation.validatedValues,
      } : {}),
    }).select("id,public_order_id,status,payment_status,fulfillment_status,service_id,target_type,target_value,quantity,unit_price,subtotal,total,currency,created_at").single();
    if (orderError) throw orderError;
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    console.error("Order creation failed", error);
    if (error instanceof Error && /required|Unknown dynamic field key|unsupported|not available|invalid|must be text|exceed|Field "/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Unable to create order." }, { status: 500 });
  }
}
