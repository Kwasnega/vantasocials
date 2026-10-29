import "server-only";

import crypto from "node:crypto";
import { createSupabaseAdminClient } from "../supabase/server";
import { claimOrder, releaseOrderClaim } from "./claims";
import { fulfillPaidOrder } from "./worker";
import {
  normalizePersistedProviderInputMappings,
  type PersistedProviderInputMapping,
} from "./service-input-mapping";

export type DispatchOutcome =
  | "LIVE_FULFILLMENT_DISABLED"
  | "TEST_MODE_BLOCKED"
  | "CANARY_PINNED_ORDER_REQUIRES_EXPLICIT_ACTION"
  | "ORDER_NOT_ELIGIBLE"
  | "PROVIDER_NOT_SUPPORTED"
  | "ALREADY_CLAIMED"
  | "MISSING_MAPPING"
  | "SUBMISSION_REJECTED"
  | "SUBMISSION_AMBIGUOUS"
  | "DISPATCH_ERROR"
  | "SUBMITTED";

async function recordDispatchEvent(
  orderId: string,
  eventType: string,
  errorCode: string,
  metadata: Record<string, unknown> = {},
) {
  try {
    const admin = createSupabaseAdminClient();
    await admin.from("provider_order_events").insert({
      order_id: orderId,
      event_type: eventType,
      error_code: errorCode.slice(0, 1000),
      metadata,
    });
  } catch (err) {
    console.warn("Failed to record dispatch event:", err);
  }
}

async function transitionOrder(orderId: string, from: "NOT_STARTED" | "SUBMITTING", to: "SUBMITTING" | "SUBMITTED") {
  const { data, error } = await createSupabaseAdminClient().rpc("transition_fulfillment_state", {
    p_order_id: orderId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  if (data !== true) throw new Error("FULFILLMENT_STATE_TRANSITION_REJECTED");
}

async function persistAttemptFailureState(orderId: string, currentStatus: string) {
  const admin = createSupabaseAdminClient();
  const { data: attempt, error } = await admin
    .from("provider_orders")
    .select("id,attempt_status,provider_order_id")
    .eq("order_id", orderId)
    .eq("provider", "reliablesmm")
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!attempt || !["FAILED_BEFORE_SUBMISSION", "UNKNOWN_PENDING_RECONCILIATION"].includes(attempt.attempt_status)) return;

  if (currentStatus === "NOT_STARTED") {
    await transitionOrder(orderId, "NOT_STARTED", "SUBMITTING");
  }

  if (attempt.attempt_status === "UNKNOWN_PENDING_RECONCILIATION" && !attempt.provider_order_id) {
    const { error: reviewError } = await admin.rpc("require_provider_manual_review", {
      p_attempt_id: attempt.id,
      p_reason: "Submission outcome is ambiguous and no provider order ID was persisted.",
    });
    if (reviewError) throw reviewError;
  }
}

export async function dispatchPaidOrder(orderId: string): Promise<{ outcome: DispatchOutcome; reason?: string }> {
  if (process.env.PANELS_LIVE_FULFILLMENT_ENABLED !== "true") {
    await recordDispatchEvent(orderId, "DISPATCH_SKIPPED", "LIVE_FULFILLMENT_DISABLED", {
      message: "PANELS_LIVE_FULFILLMENT_ENABLED is not set to true",
    });
    return { outcome: "LIVE_FULFILLMENT_DISABLED" };
  }
  if (process.env.R4_TEST_MODE === "true") {
    await recordDispatchEvent(orderId, "DISPATCH_SKIPPED", "TEST_MODE_BLOCKED", {
      message: "R4_TEST_MODE is true",
    });
    return { outcome: "TEST_MODE_BLOCKED" };
  }
  if (process.env.RELIABLESMM_CANARY_ORDER_ID === orderId) {
    await recordDispatchEvent(orderId, "DISPATCH_SKIPPED", "CANARY_PINNED_ORDER_REQUIRES_EXPLICIT_ACTION", {
      message: "Order matches RELIABLESMM_CANARY_ORDER_ID pin",
    });
    return { outcome: "CANARY_PINNED_ORDER_REQUIRES_EXPLICIT_ACTION" };
  }

  const admin = createSupabaseAdminClient();
  const { data: order, error } = await admin
    .from("orders")
    .select("id,public_order_id,total,service_id,payment_status,fulfillment_status,target_type,target_value,quantity,input_schema_version,input_schema_snapshot,input_values,services!inner(id,slug,provider,provider_service_id)")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  if (
    !order
    || order.payment_status !== "PAID"
    || !["NOT_STARTED", "SUBMITTING"].includes(order.fulfillment_status)
  ) {
    await recordDispatchEvent(orderId, "DISPATCH_SKIPPED", "ORDER_NOT_ELIGIBLE", {
      payment_status: order?.payment_status ?? null,
      fulfillment_status: order?.fulfillment_status ?? null,
    });
    return { outcome: "ORDER_NOT_ELIGIBLE" };
  }

  const service = Array.isArray(order.services) ? order.services[0] : order.services;
  if (!service?.slug || service.provider !== "reliablesmm") {
    await recordDispatchEvent(orderId, "DISPATCH_SKIPPED", "PROVIDER_NOT_SUPPORTED", {
      provider: service?.provider ?? null,
      slug: service?.slug ?? null,
    });
    return { outcome: "PROVIDER_NOT_SUPPORTED" };
  }

  const ownerToken = crypto.randomUUID();
  if (!(await claimOrder(order.id, ownerToken))) {
    await recordDispatchEvent(orderId, "DISPATCH_SKIPPED", "ALREADY_CLAIMED", {
      message: "Fulfillment claim is currently held by another worker or in-flight process",
    });
    return { outcome: "ALREADY_CLAIMED" };
  }

  try {
    const { data: rawMappings, error: mappingsError } = await admin
      .from("service_provider_input_mappings")
      .select("service_id,provider,provider_service_id,provider_parameter_key,transform_id,transform_version,provider_required,omit_when_blank,schema_version,active,service_input_fields!service_provider_input_mappings_service_field_fk(key)")
      .eq("service_id", order.service_id)
      .eq("active", true)
      .order("created_at", { ascending: true });

    if (mappingsError) {
      await recordDispatchEvent(orderId, "DISPATCH_FAILED", "MAPPINGS_QUERY_ERROR", {
        error: mappingsError.message,
      });
      throw mappingsError;
    }

    let mappings;
    try {
      mappings = normalizePersistedProviderInputMappings(
        (rawMappings ?? []) as unknown as PersistedProviderInputMapping[],
      );
    } catch (normErr) {
      await recordDispatchEvent(orderId, "DISPATCH_FAILED", "MISSING_MAPPING", {
        error: normErr instanceof Error ? normErr.message : "Mapping normalization failed",
      });
      return { outcome: "MISSING_MAPPING", reason: normErr instanceof Error ? normErr.message : "Mapping error" };
    }

    try {
      const result = await fulfillPaidOrder({
        orderId: order.id,
        vantaSlug: service.slug,
        targetType: order.target_type,
        targetValue: order.target_value,
        quantity: order.quantity,
        prefetchedOrder: order,
        prefetchedMappings: mappings,
        allowLiveSubmission: true,
      });

      const attemptStatus = result && "attempt" in result
        ? result.attempt && typeof result.attempt === "object" && "attempt_status" in result.attempt
          ? result.attempt.attempt_status
          : null
        : result && "attempt_status" in result
          ? result.attempt_status
          : null;

      if (attemptStatus !== "SUBMITTED") {
        if (attemptStatus === "UNKNOWN_PENDING_RECONCILIATION") {
          await persistAttemptFailureState(order.id, order.fulfillment_status);
          await recordDispatchEvent(orderId, "DISPATCH_FAILED", "SUBMISSION_AMBIGUOUS", {
            attempt_status: attemptStatus,
          });
          return { outcome: "SUBMISSION_AMBIGUOUS", reason: "Submission outcome is ambiguous and awaiting reconciliation." };
        }
        await persistAttemptFailureState(order.id, order.fulfillment_status);
        await recordDispatchEvent(orderId, "DISPATCH_FAILED", "SUBMISSION_REJECTED", {
          attempt_status: attemptStatus,
        });
        return { outcome: "SUBMISSION_REJECTED", reason: "Provider did not confirm order submission." };
      }

      if (order.fulfillment_status === "NOT_STARTED") {
        await transitionOrder(order.id, "NOT_STARTED", "SUBMITTING");
      }
      await transitionOrder(order.id, "SUBMITTING", "SUBMITTED");
      await recordDispatchEvent(orderId, "CUSTOMER_FULFILLMENT_TRANSITION", "SUBMITTED", {
        from: order.fulfillment_status,
        to: "SUBMITTED",
      });
      return { outcome: "SUBMITTED" };
    } catch (error) {
      await persistAttemptFailureState(order.id, order.fulfillment_status);
      await recordDispatchEvent(orderId, "DISPATCH_FAILED", "DISPATCH_ERROR", {
        error: error instanceof Error ? error.message : "Submission failed",
      });
      throw error;
    }
  } finally {
    await releaseOrderClaim(order.id, ownerToken);
  }
}
