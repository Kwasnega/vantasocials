import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "../../../../lib/auth/require-user";
import { createSupabaseAdminClient } from "../../../../lib/supabase/server";
import { formatOrderInputValue } from "../../../../lib/orders/display-input-values";
import { buildOrderTimeline, formatOrderTimelineStatus } from "../../../../lib/orders/timeline";
import OrderStatusRefresh from "../../../../components/orders/OrderStatusRefresh";

function getPaymentDescription(status: string) {
  switch (status) {
    case "PAID":
      return "Your order total has been received.";
    case "UNPAID":
      return "Payment is still needed before fulfillment can begin.";
    case "PENDING":
      return "We’re waiting for the payment provider to confirm this transaction.";
    case "FAILED":
      return "The payment attempt was unsuccessful. Contact support if this doesn’t look right.";
    case "REFUNDED":
      return "The payment for this order has been refunded.";
    case "PARTIALLY_REFUNDED":
      return "Part of the payment for this order has been refunded.";
    default:
      return "Check back here for payment updates.";
  }
}

function getFulfillmentDescription(status: string, paid: boolean) {
  switch (status) {
    case "NOT_STARTED":
      return paid
        ? "Payment is confirmed. Your order is queued and will be submitted automatically within moments."
        : "Fulfillment will begin after payment is confirmed.";
    case "SUBMITTING":
      return "Your order has been submitted to fulfillment and is awaiting dispatch confirmation.";
    case "SUBMITTED":
      return "Order confirmed by the fulfillment provider. Work is preparing to start.";
    case "PROCESSING":
      return "Your order is actively in progress.";
    case "COMPLETED":
      return "Your order has been successfully completed.";
    case "PARTIAL":
      return "Part of the requested quantity was delivered. The remainder has been settled.";
    case "FAILED":
      return "We are processing an issue with your order fulfillment. Our support team is attending to it.";
    case "CANCELLED":
      return "This order has been cancelled.";
    default:
      return "Check back here for fulfillment updates.";
  }
}

export default async function AccountOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { user, db } = await requireUser("/account/orders");
  const { id } = await params;
  const { data: order, error } = await db.from("orders")
    .select("id,public_order_id,target_type,target_value,quantity,unit_price,total,currency,status,payment_status,fulfillment_status,created_at,updated_at,input_values,services(name,platforms(name))")
    .eq("public_order_id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!order) notFound();

  const paid = order.payment_status === "PAID";
  const service = order.services as { name?: string; platforms?: { name?: string } | null } | null;

  const admin = createSupabaseAdminClient();

  const [
    { data: payments, error: paymentsError },
    { data: walletTransactions, error: walletTransactionsError },
    { data: providerAttempts, error: providerAttemptsError },
    { data: orderProviderEvents, error: orderProviderEventsError },
    { data: customerStatus, error: customerStatusError },
  ] = await Promise.all([
    db.from("payments")
      .select("id,provider,status,created_at,paid_at,updated_at")
      .eq("order_id", order.id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(50),
    db.from("wallet_transactions")
      .select("id,type,direction,status,created_at,updated_at")
      .eq("order_id", order.id)
      .order("created_at", { ascending: true })
      .limit(50),
    admin.from("provider_orders")
      .select("id,attempt_number,attempt_status,request_started_at,response_received_at,start_count,remains,status,created_at")
      .eq("order_id", order.id)
      .order("created_at", { ascending: true })
      .limit(50),
    admin.from("provider_order_events")
      .select("id,provider_order_id,event_type,provider_status,metadata,created_at")
      .eq("order_id", order.id)
      .order("created_at", { ascending: false })
      .limit(100),
    admin.from("customer_provider_order_status")
      .select("status,start_count,remains,created_at,updated_at")
      .eq("order_id", order.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (paymentsError) throw paymentsError;
  if (walletTransactionsError) throw walletTransactionsError;
  if (providerAttemptsError) throw providerAttemptsError;
  if (orderProviderEventsError) throw orderProviderEventsError;
  if (customerStatusError) console.warn("Could not query customer_provider_order_status:", customerStatusError);

  const providerAttemptIds = (providerAttempts ?? []).map((attempt) => attempt.id);
  let attemptProviderEvents: typeof orderProviderEvents = [];
  if (providerAttemptIds.length > 0) {
    const { data, error: attemptProviderEventsError } = await admin.from("provider_order_events")
      .select("id,provider_order_id,event_type,provider_status,metadata,created_at")
      .in("provider_order_id", providerAttemptIds)
      .order("created_at", { ascending: false })
      .limit(200);
    if (attemptProviderEventsError) throw attemptProviderEventsError;
    attemptProviderEvents = data ?? [];
  }

  const timeline = buildOrderTimeline({
    orderId: order.id,
    createdAt: order.created_at,
    payments: payments ?? [],
    walletTransactions: walletTransactions ?? [],
    providerAttempts: providerAttempts ?? [],
    providerEvents: [...(orderProviderEvents ?? []), ...attemptProviderEvents],
  });

  const inputValues = order.input_values && typeof order.input_values === "object" && !Array.isArray(order.input_values)
    ? Object.entries(order.input_values as Record<string, unknown>)
    : [];

  const paymentLabel = formatOrderTimelineStatus(order.payment_status);
  const fulfillmentLabel = formatOrderTimelineStatus(order.fulfillment_status);

  // Safe Progress calculations
  const latestAttempt = (providerAttempts ?? [])[(providerAttempts ?? []).length - 1];
  const startCount = typeof customerStatus?.start_count === "number"
    ? customerStatus.start_count
    : typeof latestAttempt?.start_count === "number" ? latestAttempt.start_count : null;
  const remains = typeof customerStatus?.remains === "number"
    ? customerStatus.remains
    : typeof latestAttempt?.remains === "number" ? latestAttempt.remains : null;
  let progressPercent: number | null = null;
  let deliveredCount: number | null = null;

  if (order.fulfillment_status === "COMPLETED") {
    progressPercent = 100;
    deliveredCount = order.quantity;
  } else if (remains !== null && order.quantity > 0) {
    deliveredCount = Math.max(0, order.quantity - remains);
    progressPercent = Math.min(100, Math.max(0, Math.round((deliveredCount / order.quantity) * 100)));
  }

  const lastUpdatedTime = customerStatus?.updated_at ?? order.updated_at;

  return (
    <div className="order-detail-page">
      <OrderStatusRefresh
        publicOrderId={order.public_order_id}
        paymentStatus={order.payment_status}
        fulfillmentStatus={order.fulfillment_status}
      />
      <Link className="order-detail-back" href="/account/orders">
        <span aria-hidden="true">←</span> All orders
      </Link>

      <header className="order-detail-header">
        <p className="dashboard-kicker">ORDER DETAILS</p>
        <div className="order-detail-title-row">
          <h1>{order.public_order_id}</h1>
          <span className={`order-detail-payment-chip ${order.payment_status.toLowerCase().replaceAll("_", "-")}`}>
            <i aria-hidden="true" />
            {paymentLabel}
          </span>
        </div>
        <p className="order-detail-service">
          <span>{service?.platforms?.name ?? "Platform"}</span>
          <b aria-hidden="true">/</b>
          <span>{service?.name ?? "VANTA service"}</span>
        </p>
      </header>

      <section className="order-detail-summary" aria-label="Order status summary">
        <div className="order-detail-total">
          <span>ORDER TOTAL</span>
          <strong>{order.total} <small>{order.currency}</small></strong>
          <p>Quantity: {order.quantity.toLocaleString()}</p>
        </div>
        <div className="order-detail-statuses">
          <article className={`order-detail-status-card payment-${order.payment_status.toLowerCase().replaceAll("_", "-")}`}>
            <span className="order-detail-status-icon" aria-hidden="true">{paid ? "✓" : "¤"}</span>
            <div>
              <span className="order-detail-label">PAYMENT</span>
              <h2>{paymentLabel}</h2>
              <p>{getPaymentDescription(order.payment_status)}</p>
            </div>
          </article>
          <article className={`order-detail-status-card fulfillment-${order.fulfillment_status.toLowerCase().replaceAll("_", "-")}`}>
            <span className="order-detail-status-icon" aria-hidden="true">
              {order.fulfillment_status === "COMPLETED" ? "✓" : "→"}
            </span>
            <div>
              <span className="order-detail-label">FULFILLMENT</span>
              <h2>{fulfillmentLabel}</h2>
              <p>{getFulfillmentDescription(order.fulfillment_status, paid)}</p>

              {progressPercent !== null && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#a99bb2", marginBottom: 4 }}>
                    <span>Progress: {progressPercent}%</span>
                    {deliveredCount !== null && (
                      <span>{deliveredCount.toLocaleString()} / {order.quantity.toLocaleString()} delivered</span>
                    )}
                  </div>
                  <div style={{ height: 6, background: "rgba(255,255,255,0.1)", borderRadius: 3, overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${progressPercent}%`,
                        height: "100%",
                        background: "linear-gradient(90deg, #9146ff, #00f0ff)",
                        transition: "width 0.5s ease",
                      }}
                    />
                  </div>
                </div>
              )}

              {startCount !== null && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#a99bb2" }}>
                  <span>Initial count recorded: {startCount.toLocaleString()}</span>
                </div>
              )}

              {lastUpdatedTime && (
                <div style={{ marginTop: 6, fontSize: 11, color: "#776c82" }}>
                  Status as of: {new Date(lastUpdatedTime).toLocaleString()}
                </div>
              )}
            </div>
          </article>
        </div>
      </section>

      <section className="order-detail-panel" aria-labelledby="order-information-title">
        <div className="order-detail-panel-heading">
          <div>
            <span className="order-detail-label">YOUR REQUEST</span>
            <h2 id="order-information-title">Order information</h2>
          </div>
        </div>
        <dl className="order-detail-fields">
          {inputValues.length === 0 ? (
            <div className="order-detail-field order-detail-target">
              <dt>Target</dt>
              <dd>{order.target_value}</dd>
            </div>
          ) : (
            inputValues.map(([key, value]) => (
              <div className="order-detail-field order-detail-target" key={key}>
                <dt>{key.replaceAll("_", " ")}</dt>
                <dd className="order-input-value">{formatOrderInputValue(value)}</dd>
              </div>
            ))
          )}
          <div className="order-detail-field">
            <dt>Quantity</dt>
            <dd>{order.quantity.toLocaleString()}</dd>
          </div>
          <div className="order-detail-field">
            <dt>Price per unit</dt>
            <dd>{order.unit_price} {order.currency}</dd>
          </div>
          <div className="order-detail-field">
            <dt>Order total</dt>
            <dd>{order.total} {order.currency}</dd>
          </div>
          <div className="order-detail-field">
            <dt>Order reference</dt>
            <dd>{order.public_order_id}</dd>
          </div>
        </dl>
      </section>

      <section className="order-detail-panel order-detail-timeline" aria-labelledby="order-timeline-title">
        <div className="order-detail-panel-heading">
          <div>
            <span className="order-detail-label">ORDER HISTORY</span>
            <h2 id="order-timeline-title">Timeline</h2>
          </div>
          <span className="order-detail-timeline-current">
            {timeline.length === 1
              ? "No updates yet"
              : timeline.length === 2
                ? "1 recorded update"
                : `${timeline.length - 1} recorded updates`}
          </span>
        </div>
        <ol>
          {timeline.map((event, index) => (
            <li key={event.id}>
              <span className={`order-detail-timeline-dot ${event.kind}${index === 0 ? " is-complete" : ""}`} aria-hidden="true">
                {index === 0 ? "✓" : "•"}
              </span>
              <div>
                <strong>{event.label}</strong>
                {event.detail && <p>{event.detail}</p>}
                <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time>
              </div>
            </li>
          ))}
        </ol>
        {timeline.length === 1 && (
          <p className="order-detail-timeline-empty">
            No payment or fulfillment events have been recorded for this order yet. This history updates when new activity is saved.
          </p>
        )}
      </section>

      <Link className="order-detail-bottom-link" href="/account/orders">
        <span aria-hidden="true">←</span> Back to all orders
      </Link>
    </div>
  );
}
