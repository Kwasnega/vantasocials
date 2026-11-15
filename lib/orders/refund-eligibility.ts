/**
 * lib/orders/refund-eligibility.ts
 *
 * Single deterministic authority for deciding whether an order can be refunded to the customer's wallet.
 * Enforces safety against double refunds, orders in flight, and orders submitted to providers.
 */
import "server-only";

export type RefundOrderInput = {
  id: string;
  payment_status: string;
  fulfillment_status: string;
  failure_reason?: string | null;
  refund_status?: string | null;
  target_fix_status?: string | null;
  total?: number | null;
  currency?: string | null;
  provider_order_id?: string | null;
  latest_attempt_status?: string | null;
};

export type RefundEligibilityResult = {
  eligible: boolean;
  requiresConfirmation: boolean;
  canRefund: boolean;
  reason: string;
};

/**
 * Determines whether an order is eligible for wallet refund.
 *
 * Rules:
 * 1. Must be PAID.
 * 2. Must not be already REFUNDED.
 * 3. Currency must be GHS and total > 0.
 * 4. Provider order must NOT exist (provider_order_id must be null/empty).
 * 5. Orders in SUBMITTING, UNKNOWN_PENDING_RECONCILIATION, or provider_timeout/unknown
 *    are AMBIGUOUS and require explicit admin confirmation (cannot be auto-refunded).
 * 6. Completed orders or in-progress orders (PROCESSING) are NOT refundable via this flow.
 * 7. Non-retryable failed orders (invalid_target not fixed, provider_rejected, expired fix token,
 *    failed_before_submission) are directly eligible.
 */
export function getRefundEligibility(order: RefundOrderInput): RefundEligibilityResult {
  if (order.refund_status === "REFUNDED") {
    return {
      eligible: false,
      requiresConfirmation: false,
      canRefund: false,
      reason: "Order has already been refunded.",
    };
  }

  if (order.payment_status !== "PAID") {
    return {
      eligible: false,
      requiresConfirmation: false,
      canRefund: false,
      reason: `Order payment status is ${order.payment_status}. Only paid orders can be refunded.`,
    };
  }

  if (!order.total || order.total <= 0 || order.currency !== "GHS") {
    return {
      eligible: false,
      requiresConfirmation: false,
      canRefund: false,
      reason: "Order does not have a valid positive GHS amount to refund.",
    };
  }

  if (order.provider_order_id && order.provider_order_id.trim().length > 0) {
    return {
      eligible: false,
      requiresConfirmation: false,
      canRefund: false,
      reason: `Order was already submitted to the provider (ID: ${order.provider_order_id}). Provider refunds/cancellations must be handled via the provider panel first.`,
    };
  }

  if (order.fulfillment_status === "COMPLETED") {
    return {
      eligible: false,
      requiresConfirmation: false,
      canRefund: false,
      reason: "Order is already completed.",
    };
  }

  if (order.fulfillment_status === "PROCESSING") {
    return {
      eligible: false,
      requiresConfirmation: false,
      canRefund: false,
      reason: "Order is currently processing at the provider.",
    };
  }

  // Ambiguous cases requiring explicit admin confirmation
  const isAmbiguous =
    order.fulfillment_status === "SUBMITTING" ||
    order.failure_reason === "provider_timeout" ||
    order.failure_reason === "unknown" ||
    order.latest_attempt_status === "UNKNOWN_PENDING_RECONCILIATION";

  if (isAmbiguous) {
    return {
      eligible: false,
      requiresConfirmation: true,
      canRefund: true, // Can refund if admin explicitly confirms
      reason: "Outcome is ambiguous (timeout, unknown error, or pending reconciliation). Verification required to confirm no provider order exists.",
    };
  }

  // Target fix awaiting customer: not eligible for auto-refund yet unless expired or admin overrides
  if (order.target_fix_status === "AWAITING_CUSTOMER") {
    return {
      eligible: false,
      requiresConfirmation: true,
      canRefund: true,
      reason: "Customer was asked to fix target link. Waiting for customer response, but admin can refund if desired.",
    };
  }

  // Eligible non-ambiguous failed cases:
  // - fulfillment_status === 'FAILED'
  // - failure_reason is invalid_target, provider_rejected, provider_insufficient_funds, provider_unreachable, system_error
  // - or target_fix_status is EXPIRED
  return {
    eligible: true,
    requiresConfirmation: false,
    canRefund: true,
    reason: "Order is eligible for wallet refund.",
  };
}
