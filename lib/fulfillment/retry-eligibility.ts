/**
 * lib/fulfillment/retry-eligibility.ts
 *
 * Server-side determination of whether a failed or stalled order can be retried.
 * Enforces strict safety against duplicate provider submissions and duplicate charges.
 */
import "server-only";
import type { OrderFailureReason } from "./failure-classifier";

export type RetryEligibilityInput = {
  id: string;
  payment_status: string;
  fulfillment_status: string;
  failure_reason?: string | null;
  provider_order_id?: string | null;
  attempt_status?: string | null;
  created_at?: string;
  last_attempt_at?: string | null;
};

export type RetryEligibilityResult = {
  eligible: boolean;
  reason: string;
  canForce?: boolean; // For timeout / ambiguous cases requiring confirmation
};

/**
 * Determines retry eligibility for an order.
 *
 * Rules:
 * - Order must be PAID.
 * - Order must NOT have a recorded provider_order_id.
 * - Order fulfillment_status must be 'FAILED' for auto-eligibility.
 * - If provider attempt_status exists, it MUST be 'FAILED_BEFORE_SUBMISSION'.
 *   If attempt_status is 'UNKNOWN_PENDING_RECONCILIATION', the request crossed the boundary,
 *   so it is NEVER auto-eligible (requires manual force review).
 * - Auto-eligible reasons: ONLY `provider_insufficient_funds` or pre-connection `provider_unreachable`.
 * - Ambiguous reasons (`provider_timeout`, `unknown`, `provider_rejected`): require review / force retry.
 * - Customer error reasons (`invalid_target`): not eligible (customer must change target).
 */
export function getRetryEligibility(order: RetryEligibilityInput): RetryEligibilityResult {
  if (order.payment_status !== "PAID") {
    return {
      eligible: false,
      reason: `Order payment status is ${order.payment_status}. Only paid orders can be fulfilled.`,
    };
  }

  if (order.provider_order_id) {
    return {
      eligible: false,
      reason: "Order already has an active provider order ID and was received by the provider.",
    };
  }

  if (["COMPLETED", "PROCESSING", "SUBMITTED"].includes(order.fulfillment_status)) {
    return {
      eligible: false,
      reason: `Order is currently in ${order.fulfillment_status} state.`,
    };
  }

  // If there is an existing provider attempt, it must NOT be UNKNOWN_PENDING_RECONCILIATION
  if (order.attempt_status === "UNKNOWN_PENDING_RECONCILIATION") {
    return {
      eligible: false,
      canForce: true,
      reason: "Prior attempt outcome is ambiguous (request crossed submission boundary). Manual review required before force retry.",
    };
  }

  // Check failure reason
  const failureReason = (order.failure_reason ?? "unknown") as OrderFailureReason;

  if (failureReason === "invalid_target") {
    return {
      eligible: false,
      reason: "Invalid link or private profile. The customer or admin must fix the target URL first.",
    };
  }

  if (failureReason === "internal_error") {
    return {
      eligible: false,
      reason: "System configuration error. Service mappings or database config must be corrected before retry.",
    };
  }

  // AUTO-ELIGIBLE: Only provider_insufficient_funds or pre-connection provider_unreachable
  // AND must be in FAILED state (or FAILED_BEFORE_SUBMISSION)
  if (failureReason === "provider_insufficient_funds" || failureReason === "provider_unreachable") {
    if (order.attempt_status && order.attempt_status !== "FAILED_BEFORE_SUBMISSION") {
      return {
        eligible: false,
        canForce: true,
        reason: `Provider attempt status is ${order.attempt_status}. Only attempts that failed before submission can be auto-retried.`,
      };
    }

    return {
      eligible: true,
      reason: "Eligible for automatic retry. Provider did not register or charge this order.",
    };
  }

  // AMBIGUOUS: provider_timeout, provider_rejected, unknown
  // Requires manual review or explicit admin force retry
  if (failureReason === "provider_timeout") {
    return {
      eligible: false,
      canForce: true,
      reason: "Timed out awaiting provider confirmation. The order may already exist at ReliableSMM. Check provider panel before forcing retry.",
    };
  }

  if (failureReason === "provider_rejected") {
    return {
      eligible: false,
      canForce: true,
      reason: "Provider rejected request. Review the failure details or verify service status before retrying.",
    };
  }

  return {
    eligible: false,
    canForce: true,
    reason: "Unrecognized failure outcome. Order requires manual review before retry.",
  };
}
