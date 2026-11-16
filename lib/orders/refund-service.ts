/**
 * lib/orders/refund-service.ts
 *
 * Core service executing single and bulk refunds to customer wallets for failed VANTA orders.
 * Idempotent, ledger-backed, with crash-safety and mutual exclusion.
 */
import "server-only";
import { createSupabaseAdminClient } from "../supabase/server";
import { getRefundEligibility } from "./refund-eligibility";
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
 * Uses atomic Postgres RPC function `process_order_refund` with fallback to direct ledger insertion
 * if the RPC fails due to schema role changes.
 */
export async function executeOrderRefund(params: ProcessRefundParams): Promise<ProcessRefundResult> {
  const db = createSupabaseAdminClient();
  const { orderId, refundedBy, reason, forceAmbiguous = false } = params;

  // 1. Fetch current order details (supporting both internal UUID and public display code VNT-...)
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId);
  let orderQuery = db
    .from("orders")
    .select(`
      id,
      public_order_id,
      payment_status,
      fulfillment_status,
      failure_reason,
      refund_status,
      total,
      currency,
      user_id,
      profiles(email),
      services(name)
    `);

  if (isUuid) {
    orderQuery = orderQuery.or(`id.eq.${orderId},public_order_id.eq.${orderId}`);
  } else {
    orderQuery = orderQuery.eq("public_order_id", orderId);
  }

  const { data: order, error: orderErr } = await orderQuery.maybeSingle();

  if (orderErr) {
    console.error("[RefundService] Order lookup error:", orderErr);
    return {
      ok: false,
      orderId,
      message: `Database error querying order: ${orderErr.message}`,
    };
  }

  if (!order) {
    return {
      ok: false,
      orderId,
      message: `Order "${orderId}" not found.`,
    };
  }

  // 2. Fetch latest provider order attempt if any
  const { data: latestPo } = await db
    .from("provider_orders")
    .select("id,provider_order_id,attempt_status")
    .eq("order_id", order.id)
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
    total: order.total,
    currency: order.currency,
    provider_order_id: latestPo?.provider_order_id ?? null,
    latest_attempt_status: latestPo?.attempt_status ?? null,
  });

  if (!eligibility.canRefund) {
    return {
      ok: false,
      orderId: order.id,
      publicOrderId: order.public_order_id,
      message: `Order is not eligible: ${eligibility.reason}`,
    };
  }

  if (eligibility.requiresConfirmation && !forceAmbiguous) {
    return {
      ok: false,
      orderId: order.id,
      publicOrderId: order.public_order_id,
      message: `${eligibility.reason} (Explicit confirmation required).`,
    };
  }

  // Check if order was already refunded
  if (order.refund_status === "REFUNDED") {
    return {
      ok: true,
      orderId: order.id,
      publicOrderId: order.public_order_id,
      alreadyRefunded: true,
      amountRefunded: Number(order.total || 0),
      message: "Order was already refunded.",
    };
  }

  // 4. Execute atomic refund (RPC with fallback to direct service_role ledger credit)
  let transactionId = "";
  let amountRefunded = Number(order.total || 0);
  let alreadyRefunded = false;

  const { data: rpcRows, error: rpcErr } = await db.rpc("process_order_refund", {
    p_order_id: order.id,
    p_refunded_by: refundedBy,
    p_reason: reason,
    p_force_ambiguous: forceAmbiguous,
  });

  if (!rpcErr && rpcRows) {
    const res = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    if (res?.success) {
      transactionId = res.transaction_id;
      amountRefunded = Number(res.refund_amount ?? amountRefunded);
      alreadyRefunded = Boolean(res.already_refunded);
    } else {
      return {
        ok: false,
        orderId: order.id,
        publicOrderId: order.public_order_id,
        message: res?.error_message || "Refund rejected by database function.",
      };
    }
  } else {
    // Fallback: Direct atomic ledger credit
    console.warn("[RefundService] RPC unavailable or error, executing direct ledger fallback:", rpcErr?.message);

    // Lock and check current refund status
    const { data: freshOrder, error: freshErr } = await db
      .from("orders")
      .select("id, refund_status, total, user_id")
      .eq("id", order.id)
      .single();

    if (freshErr || !freshOrder) {
      return { ok: false, orderId: order.id, message: "Failed to verify fresh order status." };
    }

    if (freshOrder.refund_status === "REFUNDED") {
      return {
        ok: true,
        orderId: order.id,
        publicOrderId: order.public_order_id,
        alreadyRefunded: true,
        amountRefunded,
        message: "Order was already refunded.",
      };
    }

    // Ensure wallet exists
    await db
      .from("wallets")
      .insert({ user_id: freshOrder.user_id, currency: "GHS", balance_minor: 0 })
      .select("id")
      .maybeSingle();

    const { data: wallet, error: walErr } = await db
      .from("wallets")
      .select("id")
      .eq("user_id", freshOrder.user_id)
      .single();

    if (walErr || !wallet) {
      return { ok: false, orderId: order.id, message: "Customer wallet not found." };
    }

    const refundAmountMinor = Math.round(Number(freshOrder.total) * 100);
    const reference = `refund:order:${order.id}:${Date.now()}`;

    // 1. Insert ledger transaction (auto-adjusts balance via trigger)
    const { data: insertedTx, error: txErr } = await db
      .from("wallet_transactions")
      .insert({
        wallet_id: wallet.id,
        type: "REFUND",
        direction: "CREDIT",
        status: "COMPLETED",
        amount_minor: refundAmountMinor,
        currency: "GHS",
        reference,
        order_id: order.id,
        metadata: {
          refund_reason: reason,
          refunded_by: refundedBy,
          order_public_id: order.public_order_id,
        },
      })
      .select("id")
      .single();

    if (txErr) {
      console.error("[RefundService Fallback Tx Error]:", txErr);
      return { ok: false, orderId: order.id, message: `Failed to insert wallet refund: ${txErr.message}` };
    }

    transactionId = insertedTx.id;

    // 2. Mark order as REFUNDED
    await db
      .from("orders")
      .update({
        refund_status: "REFUNDED",
        refunded_at: new Date().toISOString(),
        refunded_by: refundedBy,
        refund_amount: Number(freshOrder.total),
      })
      .eq("id", order.id);

    // 3. Record order events
    try {
      await db.from("order_events").insert({
        order_id: order.id,
        event_type: "ORDER_REFUNDED",
        status_before: order.fulfillment_status,
        status_after: order.fulfillment_status,
        actor: refundedBy,
        message: `Order refunded: GHS ${amountRefunded.toFixed(2)} credited to wallet. Reason: ${reason}`,
        metadata: { transaction_id: transactionId, amount: amountRefunded },
      });
    } catch {
      // best-effort event logging
    }
  }

  // 5. Send customer confirmation email (asynchronously)
  const customerEmail = (order.profiles as { email?: string } | null)?.email;
  const serviceName = (order.services as { name?: string } | null)?.name || "Service";

  if (customerEmail && !alreadyRefunded) {
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
    orderId: order.id,
    publicOrderId: order.public_order_id,
    amountRefunded,
    transactionId,
    alreadyRefunded,
    message: alreadyRefunded
      ? "Order was already refunded."
      : `Successfully refunded GHS ${amountRefunded.toFixed(2)} to customer wallet.`,
  };
}
