import "server-only";

import { createSupabaseAdminClient } from "../supabase/server";
import { buildProviderPayload } from "./provider-input-transform";
import { resolveOrderExecutionMode } from "./order-execution-mode";
import { claimPanelFollowsAttempt, submitPanelFollowsAttempt } from "./panelfollows/attempt";
import { resolveProviderForService } from "./resolver";
import { fulfillReliableSMMDynamicOrder, fulfillReliableSMMOrder } from "./reliablesmm/attempt";

const isPlainObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export type FulfillmentDeps = {
  resolveProviderForService?: typeof resolveProviderForService;
  loadDynamicOrderExecutionContext?: typeof loadDynamicOrderExecutionContext;
  fulfillReliableSMMDynamicOrder?: typeof fulfillReliableSMMDynamicOrder;
  claimPanelFollowsAttempt?: typeof claimPanelFollowsAttempt;
  submitPanelFollowsAttempt?: typeof submitPanelFollowsAttempt;
};

async function loadOrderExecutionRecord(orderId: string) {
  const admin = createSupabaseAdminClient();
  const { data: order, error } = await admin
    .from("orders")
    .select("id,input_schema_version,input_schema_snapshot,input_values")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  return order ?? null;
}

export async function loadDynamicOrderExecutionContext(orderId: string) {
  const admin = createSupabaseAdminClient();
  const { data: order, error } = await admin
    .from("orders")
    .select("id,service_id,payment_status,fulfillment_status,input_schema_version,input_schema_snapshot,input_values")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  if (!order) return null;

  const mode = resolveOrderExecutionMode(order);
  if (mode !== "DYNAMIC_VALID") {
    throw new Error("Dynamic order contract is incomplete or invalid; legacy fulfillment is not permitted.");
  }

  const { data: mappings, error: mappingError } = await admin
    .from("service_provider_input_mappings")
    .select("service_id,provider,provider_service_id,provider_parameter_key,transform_id,transform_version,provider_required,omit_when_blank,schema_version,active,vanta_input_field_key")
    .eq("service_id", order.service_id)
    .eq("active", true)
    .order("created_at", { ascending: true });
  if (mappingError) throw mappingError;
  if (!Array.isArray(mappings) || mappings.length === 0) throw new Error("Dynamic order is missing active provider mappings.");

  const provider = (mappings[0] as { provider?: string } | null)?.provider ?? "reliablesmm";
  const providerServiceId = (mappings[0] as { provider_service_id?: string } | null)?.provider_service_id ?? "";
  const transformed = buildProviderPayload({
    orderId: order.id,
    serviceId: order.service_id,
    provider,
    providerServiceId,
    inputSchemaVersion: Number(order.input_schema_version ?? 1),
    inputSchemaSnapshot: Array.isArray(order.input_schema_snapshot) ? order.input_schema_snapshot : [],
    inputValues: isPlainObject(order.input_values) ? order.input_values : {},
  }, mappings as Array<Record<string, unknown>>);

  return {
    order,
    serviceId: order.service_id,
    provider: transformed.provider,
    providerServiceId: transformed.providerServiceId,
    payload: transformed.payload,
  };
}

/**
 * The single fulfillment entry point for a paid VANTA order.
 * Payment settlement remains responsible only for marking payment PAID;
 * callers should enqueue/call this worker after that transition.
 */
export async function fulfillPaidOrder(input: { orderId: string; vantaSlug: string; targetType: "username" | "url" | "post_url" | "video_url" | "channel" | "page"; targetValue: string; quantity: number }, deps: FulfillmentDeps = {}) {
  const defaultDeps: Required<FulfillmentDeps> = {
    resolveProviderForService,
    loadDynamicOrderExecutionContext,
    fulfillReliableSMMDynamicOrder,
    claimPanelFollowsAttempt,
    submitPanelFollowsAttempt,
  };
  const resolved = { ...defaultDeps, ...deps };

  const executionRecord = await loadOrderExecutionRecord(input.orderId);
  const executionMode = resolveOrderExecutionMode(executionRecord);

  switch (executionMode) {
    case "LEGACY": {
      const provider = await resolved.resolveProviderForService(input.vantaSlug);
      if (provider?.mapping.provider === "reliablesmm") {
        return { outcome: "SUBMITTED" as const, attempt: await fulfillReliableSMMOrder(input) };
      }
      const claimed = await resolved.claimPanelFollowsAttempt(input.orderId, input.vantaSlug, input.targetValue, input.quantity);
      if (claimed.kind === "existing") return { outcome: "EXISTING_ATTEMPT" as const, attempt: claimed.attempt };
      try {
        const submitted = await resolved.submitPanelFollowsAttempt(claimed.attempt.id);
        return { outcome: "SUBMITTED" as const, attempt: submitted };
      } catch (error) {
        return { outcome: error instanceof Error ? error.message : "FULFILLMENT_BLOCKED" as const, attempt: claimed.attempt };
      }
    }

    case "DYNAMIC_INVALID": {
      throw new Error("Dynamic order contract is incomplete or invalid; legacy fulfillment is not permitted.");
    }

    case "DYNAMIC_VALID": {
      const provider = await resolved.resolveProviderForService(input.vantaSlug);
      if (!provider || provider.mapping.provider !== "reliablesmm") {
        throw new Error("Dynamic order requires an approved ReliableSMM mapping.");
      }

      const dynamic = await resolved.loadDynamicOrderExecutionContext(input.orderId);
      if (!dynamic) {
        throw new Error("Dynamic order contract is incomplete or invalid; legacy fulfillment is not permitted.");
      }

      return await resolved.fulfillReliableSMMDynamicOrder({
        orderId: input.orderId,
        serviceId: dynamic.serviceId,
        provider: dynamic.provider,
        providerServiceId: dynamic.providerServiceId,
        payload: dynamic.payload,
        quantity: input.quantity,
      });
    }
  }
}
