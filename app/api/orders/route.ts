import { createHash } from "node:crypto";
import { after, NextResponse } from "next/server";
import { createSupabaseAdminClient, getCurrentUser } from "../../../lib/supabase/server";
import { clientIp, consumeRateLimits, limiterUnavailable, rateLimited, rulesFor } from "../../../lib/security/rate-limit";
import { validateDynamicFieldValues, validateDynamicOrderInput } from "../../../lib/orders/dynamic-input-validation";
import type { CustomerInputField } from "../../../lib/customer/service-contract";
import { normalizeTarget, getTargetContract } from "../../../lib/targets/contracts";
import { effectiveQuantityRange, quantityInRange } from "../../../lib/targets/quantity";
import { assertPayableOrderTotal, calculateCustomerTotal, normalizeInternalUnitRate } from "../../../lib/pricing/customer-price";
import { captureServerEvent } from "../../../lib/posthog/server";
import { flushPostHogLogs, logPostHogInfo } from "../../../lib/posthog/logs";

const isPlainObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const IDEMPOTENCY_CONSTRAINT = "orders_user_id_idempotency_key_key";
const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function orderIntentFingerprint(intent: Record<string, unknown>) {
  return createHash("sha256").update(stableJson(intent)).digest("hex");
}

function isIdempotencyConflict(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === "23505" && error.message?.includes(IDEMPOTENCY_CONSTRAINT) === true;
}

function responseOrder(order: Record<string, unknown>) {
  const {
    idempotency_key: _key,
    idempotency_fingerprint: _fingerprint,
    idempotency_service_slug: _serviceSlug,
    input_schema_snapshot: _schemaSnapshot,
    input_values: _inputValues,
    ...result
  } = order;
  return result;
}

function replayFingerprint(order: Record<string, unknown>, input: Record<string, unknown>): string | null {
  if (
    typeof input.service_id !== "string"
    || input.service_id.trim().toLowerCase() !== String(order.service_id).toLowerCase()
    || Number(input.quantity) !== Number(order.quantity)
  ) return null;

  if (Array.isArray(order.input_schema_snapshot) && order.input_schema_snapshot.length > 0) {
    const submitted = isPlainObject(input.input_values) ? input.input_values : isPlainObject(input.values) ? input.values : null;
    if (!submitted) return null;
    try {
      const validation = validateDynamicFieldValues(order.input_schema_snapshot as CustomerInputField[], submitted);
      return orderIntentFingerprint({
        service_id: order.service_id,
        quantity: Number(order.quantity),
        input_values: validation.validatedValues,
      });
    } catch {
      return null;
    }
  }

  if (typeof input.target_value !== "string" || typeof order.idempotency_service_slug !== "string") return null;
  const targetValue = input.target_value.trim();
  const contract = getTargetContract(order.idempotency_service_slug);
  const normalized = contract ? normalizeTarget(order.idempotency_service_slug, targetValue) : { valid: true as const, target: targetValue };
  if (!normalized.valid) return null;
  return orderIntentFingerprint({
    service_id: order.service_id,
    quantity: Number(order.quantity),
    target_value: normalized.target,
  });
}

async function findReplay(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string, key: string, input: Record<string, unknown>) {
  const { data: existing, error } = await admin
    .from("orders")
    .select("id,public_order_id,status,payment_status,fulfillment_status,service_id,target_type,target_value,quantity,unit_price,subtotal,total,currency,created_at,idempotency_key,idempotency_fingerprint,idempotency_service_slug,input_schema_snapshot,input_values")
    .eq("user_id", userId)
    .eq("idempotency_key", key)
    .maybeSingle();
  if (error) throw error;
  if (!existing) return null;

  const fingerprint = replayFingerprint(existing, input);
  if (!fingerprint || fingerprint !== existing.idempotency_fingerprint) {
    return NextResponse.json({ error: "This idempotency key was already used for a different order request." }, { status: 409 });
  }
  return NextResponse.json(responseOrder(existing));
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try { const rl = await consumeRateLimits(rulesFor("orders", user.id, clientIp(request), [5, 20])); if (!rl.allowed) return rateLimited(rl); } catch { return limiterUnavailable(); }
  if (Number(request.headers.get("content-length") || 0) > 8192) return NextResponse.json({ error: "Request body is too large." }, { status: 413 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid order request." }, { status: 400 });
  const input = body as Record<string, unknown>;
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return NextResponse.json({ error: "A valid Idempotency-Key UUID v4 header is required." }, { status: 400 });
  }
  const serviceId = typeof input.service_id === "string" ? input.service_id : "";
  const targetValue = typeof input.target_value === "string" ? input.target_value.trim() : "";
  let normalizedTarget: { valid: true; target: string } | null = null;
  const quantityCandidate = input.quantity;
  const quantity = typeof quantityCandidate === "number" ? quantityCandidate : Number(quantityCandidate);
  if (!serviceId || !Number.isSafeInteger(quantity) || quantity <= 0) return NextResponse.json({ error: "service_id and valid integer quantity are required." }, { status: 400 });

  try {
    const admin = createSupabaseAdminClient();
    const replay = await findReplay(admin, user.id, idempotencyKey, input);
    if (replay) return replay;

    const { data: service, error: serviceError } = await admin
      .from("services")
      .select("id,slug,platform_id,target_type,min_quantity,max_quantity,selling_rate,currency,active,provider,provider_service_id")
      .eq("id", serviceId)
      .maybeSingle();

    if (serviceError) throw serviceError;
    if (!service) return NextResponse.json({ error: "Service not found." }, { status: 404 });
    if (!service.active) return NextResponse.json({ error: "Service is not available." }, { status: 409 });

    const { data: platform, error: platformError } = await admin.from("platforms").select("id,active").eq("id", service.platform_id).maybeSingle();
    if (platformError) throw platformError;
    if (!platform || !platform.active) return NextResponse.json({ error: "Service is not available." }, { status: 409 });

    let quantityRange = effectiveQuantityRange(service.min_quantity, service.max_quantity);
    if (service.provider === "reliablesmm" && service.provider_service_id) {
      const { data: providerCatalog, error: providerCatalogError } = await admin
        .from("provider_catalog_services")
        .select("provider_status,min_quantity,max_quantity")
        .eq("provider", "reliablesmm")
        .eq("provider_service_id", service.provider_service_id)
        .maybeSingle();
      if (providerCatalogError) throw providerCatalogError;
      if (providerCatalog?.provider_status === "ACTIVE") {
        quantityRange = effectiveQuantityRange(service.min_quantity, service.max_quantity, providerCatalog.min_quantity, providerCatalog.max_quantity);
      }
    }

    const { data: activeDynamicFields, error: dynamicFieldsError } = await admin
      .from("service_input_fields")
      .select("id,key,label,input_type,required,display_order,placeholder,help_text,validation_config,active,schema_version")
      .eq("service_id", service.id)
      .eq("active", true)
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (dynamicFieldsError) throw dynamicFieldsError;
    const hasDynamicFields = (activeDynamicFields ?? []).length > 0;

    let dynamicValidation:
      | { schemaVersion: number; schemaSnapshot: unknown[]; validatedValues: Record<string, unknown> }
      | undefined;

    if (hasDynamicFields) {
      const rawDynamicValues = isPlainObject(input.input_values) ? input.input_values : isPlainObject(input.values) ? input.values : null;
      if (!rawDynamicValues) return NextResponse.json({ error: "input_values object is required for this service." }, { status: 400 });
      dynamicValidation = validateDynamicOrderInput(activeDynamicFields ?? [], rawDynamicValues);
      if (!quantityInRange(quantity, quantityRange)) {
        return NextResponse.json({ error: `Quantity must be between ${quantityRange.min} and ${quantityRange.max}.` }, { status: 400 });
      }
    } else {
      if (!targetValue) return NextResponse.json({ error: "target_value and integer quantity are required for legacy services." }, { status: 400 });
      const contract = getTargetContract(service.slug);
      const result = contract ? normalizeTarget(service.slug, targetValue) : { valid: true as const, target: targetValue.trim() };
      if (!result.valid) return NextResponse.json({ error: result.reason }, { status: 400 });
      if (!quantityInRange(quantity, quantityRange)) {
        return NextResponse.json({ error: `Quantity must be between ${quantityRange.min} and ${quantityRange.max}.` }, { status: 400 });
      }
      normalizedTarget = result;
    }

    const unitPrice = normalizeInternalUnitRate(service.selling_rate);
    const subtotal = calculateCustomerTotal(unitPrice, quantity);
    try {
      assertPayableOrderTotal(subtotal);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Order total is outside the supported payment range." }, { status: 400 });
    }
    const fingerprint = orderIntentFingerprint(hasDynamicFields
      ? { service_id: service.id, quantity, input_values: dynamicValidation!.validatedValues }
      : { service_id: service.id, quantity, target_value: normalizedTarget!.target });
    const orderInsert = {
      user_id: user.id,
      service_id: service.id,
      target_type: service.target_type,
      ...(hasDynamicFields ? { target_value: "dynamic-configured-order" } : { target_value: normalizedTarget!.target }),
      quantity,
      unit_price: unitPrice,
      subtotal,
      total: subtotal,
      currency: service.currency,
      status: "PENDING_PAYMENT",
      payment_status: "UNPAID",
      fulfillment_status: "NOT_STARTED",
      idempotency_key: idempotencyKey,
      idempotency_fingerprint: fingerprint,
      idempotency_service_slug: service.slug,
      ...(hasDynamicFields && dynamicValidation ? {
        input_schema_version: dynamicValidation.schemaVersion,
        input_schema_snapshot: dynamicValidation.schemaSnapshot,
        input_values: dynamicValidation.validatedValues,
      } : {}),
    };
    const { data: order, error: orderError } = await admin.from("orders").insert(orderInsert)
      .select("id,public_order_id,status,payment_status,fulfillment_status,service_id,target_type,target_value,quantity,unit_price,subtotal,total,currency,created_at,idempotency_key,idempotency_fingerprint,idempotency_service_slug,input_schema_snapshot,input_values")
      .single();

    if (orderError) {
      if (isIdempotencyConflict(orderError)) {
        const replay = await findReplay(admin, user.id, idempotencyKey, input);
        if (replay) return replay;
      }
      throw orderError;
    }
    await captureServerEvent(user.id, "order_created", {
      service_id: order.service_id,
      target_type: order.target_type,
      quantity: order.quantity,
      total: order.total,
      currency: order.currency,
      uses_dynamic_inputs: hasDynamicFields,
    });
    logPostHogInfo("order creation completed", {
      operation: "order_creation",
      outcome: "created",
      target_type: order.target_type,
      quantity: order.quantity,
      currency: order.currency,
      uses_dynamic_inputs: hasDynamicFields,
    });
    after(flushPostHogLogs);
    return NextResponse.json(responseOrder(order), { status: 201 });
  } catch (error) {
    console.error("Order creation failed", error);
    if (error instanceof Error && /required|Unknown dynamic field key|unsupported|not available|invalid|must be text|exceed|Field "/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Unable to create order." }, { status: 500 });
  }
}
