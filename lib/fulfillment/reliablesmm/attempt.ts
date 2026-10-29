import "server-only";
import crypto from "node:crypto";

import { createSupabaseAdminClient } from "../../supabase/server";
import { assertOrderEligibleForFulfillment } from "../service";
import { ReliableSMMAdapter } from "./adapter";
import { reliableSMMCost } from "./pricing";
import { ReliableSMMError, ReliableSMMReadOnlyClient } from "./client";
import { assertReliableSMMTarget } from "./target";
import { buildReliableSMMProviderRequest } from "./request";
import { resolveTargetInputField } from "../../targets/contracts";

export async function executeReliableSMMSubmission(input: { orderId: string; providerServiceId: string; targetValue: string; quantity: number; payload?: Record<string, unknown>; adapter?: ReliableSMMAdapter; admin?: ReturnType<typeof createSupabaseAdminClient>; dormant?: boolean; attemptId?: string }) {
  const request = buildReliableSMMProviderRequest({ providerServiceId: input.providerServiceId, quantity: input.quantity, targetValue: input.targetValue, payload: input.payload ?? {} });
  if (input.dormant) {
    return {
      outcome: "DORMANT" as const,
      orderId: input.orderId,
      providerServiceId: request.providerServiceId,
      targetValue: request.targetValue,
      quantity: request.quantity,
      payload: request.request,
      message: "Dynamic provider execution is prepared but intentionally dormant.",
    };
  }

  const adapter = input.adapter ?? new ReliableSMMAdapter();
  const admin = input.admin ?? createSupabaseAdminClient();
  const attemptId = input.attemptId ?? `submission:${input.orderId}:${input.providerServiceId}:${Date.now()}`;
  const ownerToken = crypto.randomUUID();
  let submissionBoundaryCrossed = false;
  const providerLock = await admin.rpc("acquire_provider_operation_lock", { p_operation_key: "reliablesmm:submission", p_owner_token: ownerToken, p_lease_seconds: 60 });
  if (providerLock.error || providerLock.data !== true) throw new Error("ReliableSMM submission is busy; retry later.");
  try {
    const lease = await admin.rpc("acquire_submission_lease", { p_attempt_id: attemptId, p_owner_token: ownerToken, p_lease_seconds: 60 });
    if (lease.error || lease.data !== true) throw new Error("Unable to acquire submission lease.");
    await adapter.acquireRequestGate();
    const boundary = await admin.rpc("record_submission_boundary", { p_attempt_id: attemptId, p_owner_token: ownerToken });
    if (boundary.error || boundary.data !== true) throw new Error("Unable to record submission boundary.");
    submissionBoundaryCrossed = true;
    const result = await adapter.createOrder({ providerServiceId: request.providerServiceId, targetValue: request.targetValue, quantity: request.quantity, providerParams: request.request }, true);
    const saved = await admin.rpc("persist_provider_submission_success", { p_attempt_id: attemptId, p_owner_token: ownerToken, p_provider_order_id: result.providerOrderId, p_status: "SUBMITTED", p_raw_response: result.rawResponse });
    if (saved.error || saved.data !== true) throw new Error("Provider response persistence was ambiguous.");
    if (attemptId.startsWith("submission:")) {
      return { outcome: "SUBMITTED" as const, providerOrderId: result.providerOrderId, payload: request.request };
    }
    return (await admin.from("provider_orders").select("id,attempt_status,provider_order_id,status").eq("id", attemptId).single()).data;
  } catch (error) {
    const definitivelyRejected = error instanceof ReliableSMMError && error.code === "PROVIDER_REJECTED";
    const unknown = submissionBoundaryCrossed && !definitivelyRejected;
    const code = error instanceof ReliableSMMError && error.code && /^[A-Z0-9_]{1,64}$/.test(error.code)
      ? error.code
      : "SUBMISSION_ERROR";
    const failure = await admin.rpc("record_submission_failure", {
      p_attempt_id: attemptId,
      p_owner_token: ownerToken,
      p_ambiguous: unknown,
      p_error: code,
    });
    if (failure.error || failure.data !== true) {
      throw new Error("Unable to persist the ReliableSMM submission outcome; reconciliation is required.");
    }
    throw error;
  } finally {
    await admin.rpc("release_provider_operation_lock", { p_operation_key: "reliablesmm:submission", p_owner_token: ownerToken });
  }
}

export async function fulfillReliableSMMDynamicOrder(input: {
  orderId: string;
  serviceId: string;
  vantaSlug: string;
  targetType: "username" | "url" | "post_url" | "video_url" | "channel" | "page";
  provider: string;
  providerServiceId: string;
  payload: Record<string, unknown>;
  quantity: number;
  allowLiveSubmission?: boolean;
}) {
  if (input.provider !== "reliablesmm") throw new Error("Dynamic fulfillment is only supported for ReliableSMM.");
  if (!input.providerServiceId) throw new Error("ReliableSMM provider service is required for dynamic fulfillment.");
  if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) throw new Error("Dynamic ReliableSMM payload is invalid.");

  const request = buildReliableSMMProviderRequest({ providerServiceId: input.providerServiceId, quantity: input.quantity, targetValue: String((input.payload as Record<string, unknown>).link ?? ""), payload: input.payload });
  if (input.allowLiveSubmission) {
    return fulfillReliableSMMOrder({
      orderId: input.orderId,
      vantaSlug: input.vantaSlug,
      targetType: input.targetType,
      targetValue: request.targetValue,
      quantity: request.quantity,
      expectedProviderServiceId: request.providerServiceId,
    });
  }

  return await executeReliableSMMSubmission({
    orderId: input.orderId,
    providerServiceId: request.providerServiceId,
    targetValue: request.targetValue,
    quantity: request.quantity,
    payload: request.request,
    dormant: true,
  });
}

export async function fulfillReliableSMMOrder(input: {
  orderId: string;
  vantaSlug: string;
  targetType: "username" | "url" | "post_url" | "video_url" | "channel" | "page";
  targetValue: string;
  quantity: number;
  expectedProviderServiceId?: string;
}, adapter = new ReliableSMMAdapter()) {
  if (!Number.isSafeInteger(input.quantity)) throw new Error("Invalid quantity.");
  const order = await assertOrderEligibleForFulfillment(input.orderId);
  if (input.targetType !== order.target_type) throw new Error("Fulfillment target type does not match the paid order.");
  const admin = createSupabaseAdminClient();
  const persistedTarget = await getPersistedTarget(order, admin);
  const callerTarget = assertReliableSMMTarget({ platformSlug: String(order.platform_slug ?? ""), targetType: order.target_type, targetValue: input.targetValue });
  if (callerTarget.link !== persistedTarget.link) throw new Error("Fulfillment target does not match the paid order.");
  if (order.provider !== "reliablesmm" || !order.provider_service_id) throw new Error("ReliableSMM mapping is inactive and requires manual review.");
  if (input.expectedProviderServiceId && order.provider_service_id !== input.expectedProviderServiceId) {
    throw new Error("ReliableSMM mapping changed after the dynamic request was prepared.");
  }
  const { data: approvedCatalog, error: catalogError } = await admin.from("provider_catalog_services").select("provider,provider_service_id,provider_rate,provider_currency,rate_unit,provider_status,min_quantity,max_quantity").eq("provider", "reliablesmm").eq("provider_service_id", order.provider_service_id).maybeSingle();
  if (catalogError) throw catalogError;
  if (!approvedCatalog || approvedCatalog.provider_status !== "ACTIVE" || approvedCatalog.provider_currency !== "USD" || !["PER_1000", "PER_ORDER"].includes(approvedCatalog.rate_unit)) throw new Error("ReliableSMM mapping is missing an active approved catalog entry.");
  const effectiveMin = Math.max(Number(order.vanta_min), Number(approvedCatalog.min_quantity));
  const effectiveMax = Math.min(Number(order.vanta_max), Number(approvedCatalog.max_quantity));
  if (effectiveMin > effectiveMax || input.quantity < effectiveMin || input.quantity > effectiveMax) throw new Error("Order quantity is outside the effective VANTA/provider range.");
  const account = await adapter.getBalance();
  if (account.currency !== "USD") throw new Error("ReliableSMM account currency is not supported.");
  const catalog = await new ReliableSMMReadOnlyClient().getServices();
  const providerService = catalog.find((service) => String(service.service) === order.provider_service_id);
  if (!providerService) throw new Error("ReliableSMM service is unavailable.");
  const rate = String(approvedCatalog.provider_rate);
  const providerCost = reliableSMMCost(rate, input.quantity, approvedCatalog.rate_unit);
  const key = `vanta:${order.id}:reliablesmm:${order.provider_service_id}`;
  const { data: existing } = await admin.from("provider_orders").select("id,attempt_status,provider_order_id,status").eq("idempotency_key", key).maybeSingle();
  if (existing?.attempt_status === "FAILED_BEFORE_SUBMISSION") {
    const retry = await admin.rpc("create_safe_provider_retry", { p_attempt_id: existing.id });
    if (retry.error) throw retry.error;
    if (!retry.data) return existing;
    const { data: next, error: nextError } = await admin.from("provider_orders").select("id,attempt_status,provider_order_id,status,provider_service_id,target_value,quantity").eq("id", retry.data).single();
    if (nextError || !next) throw nextError || new Error("Unable to load retry attempt.");
    return submitAttempt(next, adapter, admin);
  }
  if (existing) return existing;
  const { data: attempt, error } = await admin.from("provider_orders").insert({ order_id: order.id, attempt_number: 1, provider: "reliablesmm", provider_service_id: order.provider_service_id, idempotency_key: key, target_value: persistedTarget.link, quantity: input.quantity, provider_cost: providerCost, currency: "USD", status: "NOT_STARTED", attempt_status: "PENDING_SUBMISSION", request_started_at: new Date().toISOString() }).select().single();
  if (error) { const { data: raced } = await admin.from("provider_orders").select("id,attempt_status,provider_order_id,status").eq("idempotency_key", key).maybeSingle(); if (raced) return raced; throw new Error("Unable to claim ReliableSMM attempt."); }
  if (attempt.attempt_status !== "PENDING_SUBMISSION") return attempt;
  return submitAttempt(attempt, adapter, admin);
}

async function getPersistedTarget(order: Awaited<ReturnType<typeof assertOrderEligibleForFulfillment>>, admin: ReturnType<typeof createSupabaseAdminClient>) {
  const platformSlug = String(order.platform_slug ?? "");
  const targetType = order.target_type;
  const hasDynamicInputs = Array.isArray(order.input_schema_snapshot) && order.input_schema_snapshot.length > 0;
  if (!hasDynamicInputs) {
    if (!order.target_value) throw new Error("Paid order has no target.");
    return assertReliableSMMTarget({ platformSlug, targetType, targetValue: order.target_value });
  }

  const targetField = resolveTargetInputField(
    order.input_schema_snapshot as Array<{ key: string; inputType?: string; input_type?: string }>,
    targetType,
  );
  if (!targetField.field) throw new Error(targetField.error);
  const inputValues = order.input_values;
  const targetValue = inputValues && typeof inputValues === "object" && !Array.isArray(inputValues)
    ? (inputValues as Record<string, unknown>)[targetField.field.key]
    : null;
  if (typeof targetValue !== "string") throw new Error("Paid order is missing its configured target value.");

  const { data: mappings, error } = await admin
    .from("service_provider_input_mappings")
    .select("provider_parameter_key,transform_id,transform_version,service_input_fields!service_provider_input_mappings_service_field_fk(key)")
    .eq("service_id", order.service_id)
    .eq("provider", "reliablesmm")
    .eq("provider_service_id", order.provider_service_id)
    .eq("active", true);
  if (error) throw error;
  const linkMappings = (mappings ?? []).filter((mapping) => mapping.provider_parameter_key === "link");
  const mappingFieldKey = (mapping: (typeof linkMappings)[number]) => {
    const field = mapping.service_input_fields as { key: string } | { key: string }[] | null;
    return Array.isArray(field) ? field.length === 1 ? field[0]?.key : undefined : field?.key;
  };
  if (linkMappings.length !== 1) {
    throw new Error("ReliableSMM requires exactly one active link mapping for the configured target field.");
  }
  const mapping = linkMappings[0];
  if (mappingFieldKey(mapping) !== targetField.field.key) {
    throw new Error("ReliableSMM requires exactly one active link mapping for the configured target field.");
  }
  return assertReliableSMMTarget({
    platformSlug,
    targetType,
    targetValue,
    transformId: mapping.transform_id,
    transformVersion: Number(mapping.transform_version),
  });
}

async function submitAttempt(attempt: { id: string; attempt_status: string; provider_service_id?: string; target_value?: string; quantity?: number }, adapter: ReliableSMMAdapter, admin: ReturnType<typeof createSupabaseAdminClient>) {
  if (attempt.attempt_status !== "PENDING_SUBMISSION") return attempt;
  return executeReliableSMMSubmission({
    orderId: String(attempt.id),
    providerServiceId: String(attempt.provider_service_id ?? ""),
    targetValue: String(attempt.target_value ?? ""),
    quantity: Number(attempt.quantity ?? 0),
    payload: { service: String(attempt.provider_service_id ?? ""), link: String(attempt.target_value ?? "") },
    adapter,
    admin,
    attemptId: attempt.id,
  });
}
