import "server-only";

import { createSupabaseAdminClient } from "../supabase/server";
import { buildProviderPayload } from "./provider-input-transform";
import { resolveOrderExecutionMode } from "./order-execution-mode";
import { claimPanelFollowsAttempt, submitPanelFollowsAttempt } from "./panelfollows/attempt";
import { resolveProviderForService } from "./resolver";
import { fulfillReliableSMMDynamicOrder, fulfillReliableSMMOrder } from "./reliablesmm/attempt";
import { assertProviderMappingConsistency } from "./provider-mapping-consistency";
import { assertPayableOrderTotal } from "../pricing/customer-price";

const isPlainObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export type PrefetchedMapping = {
  service_id: string;
  provider: string;
  provider_service_id: string;
  provider_parameter_key: string;
  transform_id: string;
  transform_version: number;
  provider_required: boolean;
  omit_when_blank: boolean;
  schema_version: number;
  active: boolean;
  vanta_input_field_key: string;
};

export type PrefetchedFulfillmentOrder = {
  id: string;
  total: number | string;
  service_id: string;
  payment_status: string;
  fulfillment_status: string;
  input_schema_version?: number | null;
  input_schema_snapshot?: unknown;
  input_values?: unknown;
  services?:
    | { id?: string; slug?: string; provider?: string | null; provider_service_id?: string | null }
    | Array<{ id?: string; slug?: string; provider?: string | null; provider_service_id?: string | null }>
    | null;
};

export type FulfillmentDeps = {
  resolveProviderForService?: typeof resolveProviderForService;
  loadDynamicOrderExecutionContext?: typeof loadDynamicOrderExecutionContext;
  fulfillReliableSMMDynamicOrder?: typeof fulfillReliableSMMDynamicOrder;
  claimPanelFollowsAttempt?: typeof claimPanelFollowsAttempt;
  submitPanelFollowsAttempt?: typeof submitPanelFollowsAttempt;
};

async function loadOrderExecutionRecord(orderId: string, prefetched?: PrefetchedFulfillmentOrder | null) {
  if (prefetched && prefetched.id === orderId) {
    assertPayableOrderTotal(prefetched.total);
    return prefetched;
  }
  const admin = createSupabaseAdminClient();
  const { data: order, error } = await admin
    .from("orders")
    .select("id,total,input_schema_version,input_schema_snapshot,input_values")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  if (order) assertPayableOrderTotal(order.total);
  return order ?? null;
}
export async function loadDynamicOrderExecutionContext(
  orderId: string,
  prefetchedOrder?: PrefetchedFulfillmentOrder | null,
  prefetchedMappings?: PrefetchedMapping[] | null,
) {
  let order: PrefetchedFulfillmentOrder | null = null;
  if (prefetchedOrder && prefetchedOrder.id === orderId) {
    order = prefetchedOrder;
  } else {
    const admin = createSupabaseAdminClient();
    const { data: fetchedOrder, error } = await admin
      .from("orders")
      .select("id,total,service_id,payment_status,fulfillment_status,input_schema_version,input_schema_snapshot,input_values,services(provider,provider_service_id)")
      .eq("id", orderId)
      .maybeSingle();
    if (error) throw error;
    order = fetchedOrder;
  }
  if (!order) return null;

  const mode = resolveOrderExecutionMode(order);
  if (mode !== "DYNAMIC_VALID") {
    throw new Error("Dynamic order contract is incomplete or invalid; legacy fulfillment is not permitted.");
  }

  let mappings: PrefetchedMapping[] | null = null;
  if (Array.isArray(prefetchedMappings)) {
    mappings = prefetchedMappings;
  } else {
    const admin = createSupabaseAdminClient();
    const { data: fetchedMappings, error: mappingError } = await admin
      .from("service_provider_input_mappings")
      .select("service_id,provider,provider_service_id,provider_parameter_key,transform_id,transform_version,provider_required,omit_when_blank,schema_version,active,vanta_input_field_key")
      .eq("service_id", order.service_id)
      .eq("active", true)
      .order("created_at", { ascending: true });
    if (mappingError) throw mappingError;
    mappings = fetchedMappings;
  }
  if (!Array.isArray(mappings) || mappings.length === 0) throw new Error("Dynamic order is missing active provider mappings.");

  const serviceMapping = Array.isArray(order.services) ? order.services[0] : order.services;
  const { provider, providerServiceId } = assertProviderMappingConsistency(
    serviceMapping as { provider?: string | null; provider_service_id?: string | null } | null,
    mappings as Array<{ provider?: string | null; provider_service_id?: string | null }>,
  );
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
export async function fulfillPaidOrder(
  input: {
    orderId: string;
    vantaSlug: string;
    targetType: "username" | "url" | "post_url" | "video_url" | "channel" | "page";
    targetValue: string;
    quantity: number;
    prefetchedOrder?: PrefetchedFulfillmentOrder | null;
    prefetchedMappings?: PrefetchedMapping[] | null;
  },
  deps: FulfillmentDeps = {},
) {
  const defaultDeps: Required<FulfillmentDeps> = {
    resolveProviderForService,
    loadDynamicOrderExecutionContext,
    fulfillReliableSMMDynamicOrder,
    claimPanelFollowsAttempt,
    submitPanelFollowsAttempt,
  };
  const resolved = { ...defaultDeps, ...deps };

  const executionRecord = await loadOrderExecutionRecord(input.orderId, input.prefetchedOrder);
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

      const dynamic = await resolved.loadDynamicOrderExecutionContext(input.orderId, input.prefetchedOrder, input.prefetchedMappings);
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
