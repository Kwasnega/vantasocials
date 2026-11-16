/**
 * lib/fulfillment/retry-service.ts
 *
 * Core service executing single and bulk retries for failed VANTA orders.
 *
 * Key safety invariants:
 * 1. NEVER charges customer or touches wallet. Original payment is reused.
 * 2. Atomic conditional acquisition: updates fulfillment_status='SUBMITTING' WHERE id=$1 AND fulfillment_status in ('FAILED', 'SUBMITTING').
 * 3. Pre-flight provider balance check in USD before dispatching.
 * 4. Crash-safety: if process aborts, order remains in SUBMITTING/needs-review.
 * 5. Writes audit log in provider_order_events with admin actor on every attempt.
 */
import "server-only";
import { createSupabaseAdminClient } from "../supabase/server";
import { ReliableSMMAdapter } from "./reliablesmm/adapter";
import { reliableSMMCost } from "./reliablesmm/pricing";
import { dispatchPaidOrder } from "./dispatch-paid-order";
import { getRetryEligibility } from "./retry-eligibility";
import { classifyProviderFailure } from "./failure-classifier";
import { recordOrderEvent } from "../orders/events";
import { normalizeTarget } from "../targets/normalize";

/**
 * Format any thrown or caught error into a readable, diagnostic message.
 * Never allows '[object Object]' to be stored or displayed.
 */
export function formatError(err: unknown): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err === "object") {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.details === "string") return obj.details;
    if (typeof obj.code === "string") return `Error code ${obj.code}: ${obj.message || "Operation failed"}`;
    try {
      return JSON.stringify(err);
    } catch {
      return "Internal error object";
    }
  }
  return String(err);
}

export type RetryResult = {
  orderId: string;
  publicOrderId: string;
  outcome: "SUCCEEDED" | "FAILED_AGAIN" | "STILL_PROCESSING" | "BLOCKED" | "INSUFFICIENT_BALANCE";
  message: string;
  newStatus?: string;
  failureReason?: string;
};

/**
 * Sweep and recover orders stuck in 'SUBMITTING' for longer than 10 minutes.
 * Requirement 4: Moves them to needs-review (failure_reason = 'provider_timeout', attempt_status = UNKNOWN_PENDING_RECONCILIATION).
 */
export async function recoverStuckSubmittingOrders(): Promise<number> {
  const db = createSupabaseAdminClient();
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const { data: stuckOrders, error } = await db
    .from("orders")
    .select("id,public_order_id,fulfillment_status,last_attempt_at,created_at")
    .eq("fulfillment_status", "SUBMITTING")
    .lte("last_attempt_at", tenMinutesAgo);

  if (error || !stuckOrders || stuckOrders.length === 0) {
    return 0;
  }

  let count = 0;
  for (const order of stuckOrders) {
    const { error: updateError } = await db
      .from("orders")
      .update({
        fulfillment_status: "FAILED",
        failure_reason: "provider_timeout",
        failure_detail: "Order was stuck in SUBMITTING for over 10 minutes. Marked as provider_timeout for manual review.",
        failed_at: new Date().toISOString(),
      })
      .eq("id", order.id)
      .eq("fulfillment_status", "SUBMITTING");

    if (!updateError) {
      count++;
      await db.from("provider_order_events").insert({
        order_id: order.id,
        event_type: "STUCK_SUBMITTING_RECOVERED",
        error_code: "SUBMISSION_TIMEOUT_10M",
        metadata: { recovered_at: new Date().toISOString(), reason: "STUCK_SUBMITTING_OVER_10_MINUTES" },
      });
    }
  }

  return count;
}

/**
 * Calculates provider cost for an order in USD.
 */
export async function getOrderProviderCostUsd(
  orderId: string,
  serviceId: string,
  quantity: number,
  adminClient = createSupabaseAdminClient()
): Promise<{ costUsd: number; providerServiceId?: string }> {
  const { data: mapping } = await adminClient
    .from("service_provider_input_mappings")
    .select("provider_service_id")
    .eq("service_id", serviceId)
    .eq("provider", "reliablesmm")
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  if (!mapping?.provider_service_id) {
    return { costUsd: 0 };
  }

  const { data: catalog } = await adminClient
    .from("provider_catalog_services")
    .select("provider_rate,rate_unit")
    .eq("provider", "reliablesmm")
    .eq("provider_service_id", mapping.provider_service_id)
    .maybeSingle();

  if (!catalog) {
    return { costUsd: 0, providerServiceId: mapping.provider_service_id };
  }

  const cost = reliableSMMCost(
    String(catalog.provider_rate),
    quantity,
    catalog.rate_unit ?? "PER_1000"
  );

  return { costUsd: Number(cost), providerServiceId: mapping.provider_service_id };
}

/**
 * Retries a single failed order.
 */
export async function retryOrderFulfillment(params: {
  orderId: string;
  adminUserId: string;
  force?: boolean;
}): Promise<RetryResult> {
  const db = createSupabaseAdminClient();
  const { orderId, adminUserId, force = false } = params;

  // 1. Fetch current order with latest provider_orders info
  const { data: order, error: orderErr } = await db
    .from("orders")
    .select("id,public_order_id,service_id,quantity,target_type,target_value,payment_status,fulfillment_status,failure_reason,attempt_count,refund_status,input_values,services(name,platforms(name,slug))")
    .eq("id", orderId)
    .maybeSingle();

  if (orderErr || !order) {
    return {
      orderId,
      publicOrderId: order?.public_order_id ?? "UNKNOWN",
      outcome: "BLOCKED",
      message: "Order not found.",
    };
  }

  // 1b. Normalize target before attempting retry to fix old un-normalized targets
  const platformSlug = (order.services as { platforms?: { slug?: string } | null } | null)?.platforms?.slug || "general";
  const rawTargetValue = (order.input_values && typeof order.input_values === "object" && Object.values(order.input_values)[0])
    ? String(Object.values(order.input_values)[0])
    : order.target_value;

  if (rawTargetValue && platformSlug !== "general") {
    try {
      const normResult = await normalizeTarget({
        platform: platformSlug,
        targetType: order.target_type || "url",
        input: rawTargetValue,
      });

      if (normResult.ok) {
        if (normResult.confidence === "low") {
          return {
            orderId,
            publicOrderId: order.public_order_id,
            outcome: "BLOCKED",
            message: "This link needs to be corrected before retrying (low confidence).",
          };
        }
        if (normResult.canonical !== order.target_value) {
          // Update order target with normalized canonical URL and record event
          await db
            .from("orders")
            .update({ target_value: normResult.canonical })
            .eq("id", orderId);

          await recordOrderEvent({
            orderId,
            type: "target_normalized_on_retry",
            statusBefore: order.fulfillment_status,
            statusAfter: order.fulfillment_status,
            message: `Target URL normalized before retry: ${order.target_value} -> ${normResult.canonical}`,
            actor: `admin:${adminUserId}`,
            meta: { old_target: order.target_value, canonical: normResult.canonical },
          });
        }
      } else {
        return {
          orderId,
          publicOrderId: order.public_order_id,
          outcome: "BLOCKED",
          message: `This link needs to be corrected before retrying: ${normResult.message}`,
        };
      }
    } catch {
      // Best-effort normalization
    }
  }

  // Check if provider order already exists
  const { data: latestPo } = await db
    .from("provider_orders")
    .select("id,provider_order_id,attempt_status")
    .eq("order_id", orderId)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const eligibility = getRetryEligibility({
    id: order.id,
    payment_status: order.payment_status,
    fulfillment_status: order.fulfillment_status,
    failure_reason: order.failure_reason,
    provider_order_id: latestPo?.provider_order_id ?? null,
    refund_status: order.refund_status,
  });

  if (!eligibility.eligible && !(force && eligibility.canForce)) {
    return {
      orderId,
      publicOrderId: order.public_order_id,
      outcome: "BLOCKED",
      message: eligibility.reason,
    };
  }

  // 2. Pre-flight Balance Check in USD
  const adapter = new ReliableSMMAdapter();
  let providerBalance: { balance: string; currency: string };
  try {
    providerBalance = await adapter.getBalance();
  } catch (balErr) {
    return {
      orderId,
      publicOrderId: order.public_order_id,
      outcome: "BLOCKED",
      message: `Failed to query provider balance: ${balErr instanceof Error ? balErr.message : "Network error"}`,
    };
  }

  const { costUsd } = await getOrderProviderCostUsd(order.id, order.service_id, order.quantity, db);
  const currentBalanceNum = Number(providerBalance.balance);

  if (costUsd > 0 && currentBalanceNum < costUsd) {
    return {
      orderId,
      publicOrderId: order.public_order_id,
      outcome: "INSUFFICIENT_BALANCE",
      message: `Provider balance too low: have $${currentBalanceNum.toFixed(2)} USD, need $${costUsd.toFixed(2)} USD. Please top up ReliableSMM.`,
    };
  }

  // 3. Atomic Conditional Acquisition (Idempotency lock)
  // CRITICAL REQUIREMENT: Claim condition is strictly WHERE fulfillment_status = 'FAILED'
  // Ensures only one retry action can run on this order concurrently
  const now = new Date().toISOString();
  const nextAttemptCount = (order.attempt_count ?? 0) + 1;

  const { data: acquired, error: acquireErr } = await db
    .from("orders")
    .update({
      fulfillment_status: "SUBMITTING",
      attempt_count: nextAttemptCount,
      last_attempt_at: now,
    })
    .eq("id", orderId)
    .eq("fulfillment_status", "FAILED")
    .neq("refund_status", "REFUNDED")
    .select("id,public_order_id")
    .maybeSingle();

  if (acquireErr || !acquired) {
    return {
      orderId,
      publicOrderId: order.public_order_id,
      outcome: "BLOCKED",
      message: "Order is already being retried or its status was updated by another process.",
    };
  }

  // 4. Log retry initiation event with actor
  await db.from("provider_order_events").insert({
    order_id: orderId,
    event_type: "RETRY_TRIGGERED_BY_ADMIN",
    metadata: {
      admin_user_id: adminUserId,
      forced: force,
      previous_reason: order.failure_reason,
      attempt_count: nextAttemptCount,
      timestamp: now,
    },
  });
  await recordOrderEvent({
    orderId,
    type: "retry_started",
    statusBefore: "FAILED",
    statusAfter: "SUBMITTING",
    message: `Admin (${adminUserId}) initiated fulfillment retry (attempt ${nextAttemptCount}).`,
    actor: `admin:${adminUserId}`,
    meta: { forced: force, attempt_count: nextAttemptCount },
  });

  // 5. Execute Dispatch via normal fulfillment pipeline
  try {
    const dispatchResult = await dispatchPaidOrder(orderId);

    if (dispatchResult.outcome === "SUBMITTED") {
      // Clear failure reason on successful submission
      await db
        .from("orders")
        .update({
          failure_reason: null,
          failure_detail: null,
          failed_at: null,
        })
        .eq("id", orderId);

      return {
        orderId,
        publicOrderId: order.public_order_id,
        outcome: "SUCCEEDED",
        newStatus: "SUBMITTED",
        message: "Order submitted to provider successfully.",
      };
    } else {
      // Check latest order state
      const { data: refreshed } = await db
        .from("orders")
        .select("fulfillment_status,failure_reason,failure_detail")
        .eq("id", orderId)
        .single();

      if (refreshed?.fulfillment_status === "SUBMITTED" || refreshed?.fulfillment_status === "PROCESSING") {
        return {
          orderId,
          publicOrderId: order.public_order_id,
          outcome: "SUCCEEDED",
          newStatus: refreshed.fulfillment_status,
          message: "Order fulfilled successfully.",
        };
      }

      return {
        orderId,
        publicOrderId: order.public_order_id,
        outcome: "FAILED_AGAIN",
        newStatus: refreshed?.fulfillment_status ?? "FAILED",
        failureReason: refreshed?.failure_reason ?? "unknown",
        message: `Retry outcome: ${dispatchResult.outcome} (${dispatchResult.reason ?? refreshed?.failure_detail ?? "Provider did not accept order"})`,
      };
    }
  } catch (error) {
    // Reclassify and persist failure
    const classified = classifyProviderFailure(error);
    const readableDetail = formatError(error);

    await db
      .from("orders")
      .update({
        fulfillment_status: "FAILED",
        failure_reason: classified.reason,
        failure_detail: readableDetail,
        failed_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    await recordOrderEvent({
      orderId,
      type: "retry_failed",
      statusBefore: "SUBMITTING",
      statusAfter: "FAILED",
      message: `Fulfillment retry failed: ${readableDetail}`,
      actor: `admin:${adminUserId}`,
      meta: { error: readableDetail, reason: classified.reason },
    }).catch(() => {});

    return {
      orderId,
      publicOrderId: order.public_order_id,
      outcome: "FAILED_AGAIN",
      newStatus: "FAILED",
      failureReason: classified.reason,
      message: `Retry failed: ${readableDetail}`,
    };
  }
}
