/**
 * lib/orders/refund-service.ts
 *
 * Core service executing single and bulk refunds to customer wallets for failed VANTA orders.
 * Idempotent, ledger-backed, with crash-safety and mutual exclusion.
 */
import "server-only";
import { createSupabaseAdminClient } from "../supabase/server";
import { getRefundEligibility, type RefundOrderInput } from "./refund-eligibility";
import { sendTransactionalEmail, renderOrderRefundEmail } from "../email";

export type ProcessRefundParams = {
  orderId: string;
  refundedBy: string; // 'admin:<id>' or 'system:auto_refund'
  reason: string;
  forceAmbiguous?: boolean;
};

export type ProcessRefundResult = {
  ok: boolean;
  orderId: string;
  publicOrderId?: string;
  amountRefunded?: number;
  transactionId?: string;
  alreadyRefunded?: boolean;
  message: string;
};

/**
 * Refunds an order to the customer's wallet.
 * Uses atomic Postgres RPC function `process_order_refund`.
 */
export async function executeOrderRefund(params: ProcessRefundParams): Promise<ProcessRefundResult> {
  const db = createSupabaseAdminClient();
  const { orderId, refundedBy, reason, forceAmbiguous = false } = params;

  // 1. Fetch current order details
  const { data: order, error: orderErr } = await db
    .from("orders")
    .select(`
      id,
      public_order_id,
      payment_status,
      fulfillment_status,
      failure_reason,
      refund_status,
      target_fix_status,
      total,
      currency,
      user_id,
      profiles(email),
      services(name)
    `)
    .eq("id", orderId)
    .maybeSingle();

  if (orderErr || !order) {
    return {
      ok: false,
      orderId,
      message: "Order not found.",
    };
  }

  // 2. Fetch latest provider order attempt if any
  const { data: latestPo } = await db
    .from("provider_orders")
    .select("id,provider_order_id,attempt_status")
    .eq("order_id", orderId)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 3. Pre-flight eligibility check
  const eligibility = getRefundEligibility({
    id: order.id,
    payment_status: order.payment_status,
    fulfillment_status: order.fulfillment_status,
    failure_reason: order.failure_reason,
    refund_status: order.refund_status,
    target_fix_status: order.target_fix_status,
    total: order.total,
    currency: order.currency,
    provider_order_id: latestPo?.provider_order_id ?? null,
    latest_attempt_status: latestPo?.attempt_status ?? null,
  });

  if (!eligibility.canRefund) {
    return {
      ok: false,
      orderId,
      publicOrderId: order.public_order_id,
      message: eligibility.reason,
    };
  }

  if (eligibility.requiresConfirmation && !forceAmbiguous) {
    return {
      ok: false,
      orderId,
      publicOrderId: order.public_order_id,
      message: `${eligibility.reason} (Explicit confirmation required).`,
    };
  }

  // 4. Call atomic database RPC function
  const { data: rpcRows, error: rpcErr } = await db.rpc("process_order_refund", {
    p_order_id: order.id,
    p_refunded_by: refundedBy,
    p_reason: reason,
    p_force_ambiguous: forceAmbiguous,
  });

  if (rpcErr) {
    return {
      ok: false,
      orderId,
      publicOrderId: order.public_order_id,
      message: `Database refund failed: ${rpcErr.message}`,
    };
  }

  const result = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;

  if (!result || !result.success) {
    return {
      ok: false,
      orderId,
      publicOrderId: order.public_order_id,
      message: result?.error_message || "Refund could not be processed.",
    };
  }

  // 5. Send customer confirmation email if customer email exists (asynchronously)
  const customerEmail = (order.profiles as { email?: string } | null)?.email;
  const serviceName = (order.services as { name?: string } | null)?.name || "Service";
  const amountRefunded = Number(result.refund_amount ?? order.total ?? 0);

  if (customerEmail && !result.already_refunded) {
    try {
      const emailContent = renderOrderRefundEmail({
        publicOrderId: order.public_order_id,
        serviceName,
        amountGhs: amountRefunded,
      });
      await sendTransactionalEmail({
        to: customerEmail,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });
    } catch (emailErr) {
      console.warn("[RefundService] Failed to send customer refund email:", emailErr);
    }
  }

  return {
    ok: true,
    orderId,
    publicOrderId: order.public_order_id,
    amountRefunded,
    transactionId: result.transaction_id,
    alreadyRefunded: result.already_refunded,
    message: result.already_refunded
      ? "Order was already refunded."
      : `Successfully refunded GHS ${amountRefunded.toFixed(2)} to customer wallet.`,
  };
}
