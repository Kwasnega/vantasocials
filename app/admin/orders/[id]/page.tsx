import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../lib/supabase/server";
import { formatOrderInputValue } from "../../../../lib/orders/display-input-values";
import { AdminEmptyState, AdminQueryError } from "../../AdminDataState";
import { AdminOrderDetailTabs } from "../../../../components/admin/AdminOrderDetailTabs";
import { AdminOrderRetryAction } from "../../../../components/admin/AdminOrderRetryAction";
import { getRetryEligibility } from "../../../../lib/fulfillment/retry-eligibility";
import { CopyableValue, AdminOrderActionsBar } from "../../../../components/admin/AdminOrderActionsBar";
import { AdminOrderTimelineStepper, type PersistedTimelineEvent } from "../../../../components/admin/AdminOrderTimelineStepper";

export default async function AdminOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { admin } = await requireAdmin();
  if (!admin) return null;
  const { id } = await params;
  const db = createSupabaseAdminClient();

  // 1. Fetch order details with customer and service joins
  const { data: order, error: orderError } = await db
    .from("orders")
    .select("id,public_order_id,user_id,target_type,target_value,quantity,unit_price,subtotal,total,currency,status,payment_status,fulfillment_status,failure_reason,failure_detail,created_at,updated_at,input_schema_snapshot,input_values,profiles(id,email,full_name),services(name,slug,platforms(name))")
    .eq("public_order_id", id)
    .maybeSingle();

  if (orderError) return <AdminQueryError message="Order details could not be loaded." />;
  if (!order) notFound();

  // 2. Fetch parallel data: payments, wallet entries, provider attempts, and persisted order_events (limit 200)
  const [
    { data: payments, error: paymentsError },
    { data: walletEntries, error: walletEntriesError },
    { data: providerOrders, error: providerOrdersError },
    { data: rawEvents, error: eventsError },
  ] = await Promise.all([
    db.from("payments").select("id,provider,reference,amount,currency,status,paid_at,created_at").eq("order_id", order.id).order("created_at", { ascending: false }).limit(20),
    db.from("wallet_transactions").select("id,type,direction,status,amount_minor,reference,created_at").eq("order_id", order.id).limit(20),
    db.from("provider_orders").select("id,provider,provider_order_id,provider_service_id,status,attempt_status,error_code,charge,remains,start_count,raw_response,last_polled_at,last_submission_error,created_at,updated_at").eq("order_id", order.id).order("created_at", { ascending: false }).limit(20),
    db.from("order_events").select("id,type,status_before,status_after,message,meta,actor,created_at").eq("order_id", order.id).order("created_at", { ascending: true }).limit(200),
  ]);

  const service = order.services as { name?: string; slug?: string; platforms?: { name?: string } | null } | null;
  const customer = order.profiles as { id?: string; email?: string; full_name?: string } | null;
  const latestProviderOrder = providerOrders?.[0];

  const inputValues = order.input_values && typeof order.input_values === "object" && !Array.isArray(order.input_values)
    ? Object.entries(order.input_values as Record<string, unknown>)
    : [];
  const snapshotFields = Array.isArray(order.input_schema_snapshot) ? order.input_schema_snapshot : [];
  const snapshotByKey = new Map<string, { label: string; displayOrder: number; index: number }>();
  snapshotFields.forEach((field, index) => {
    if (!field || typeof field !== "object" || Array.isArray(field)) return;
    const definition = field as Record<string, unknown>;
    if (typeof definition.key !== "string") return;
    snapshotByKey.set(definition.key, {
      label: typeof definition.label === "string" && definition.label.trim() ? definition.label : definition.key.replaceAll("_", " "),
      displayOrder: Number(definition.displayOrder ?? definition.display_order ?? index),
      index,
    });
  });

  const orderedInputValues = inputValues
    .map(([key, value]) => ({ key, value, field: snapshotByKey.get(key) }))
    .sort((left, right) => {
      if (!left.field) return right.field ? 1 : left.key.localeCompare(right.key);
      if (!right.field) return -1;
      return left.field.displayOrder - right.field.displayOrder || left.field.index - right.field.index;
    });

  // Timeline Tab Content (Requirement 3: vertical stepper + persisted chronological event log)
  const timelineEvents = (rawEvents ?? []) as PersistedTimelineEvent[];
  const timelineContent = (
    <AdminOrderTimelineStepper
      events={timelineEvents}
      currentStatus={order.fulfillment_status}
      failureReason={order.failure_reason}
    />
  );

  // Overview Tab Content (Requirement 3: comprehensive detail panels)
  const overviewSection = (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Customer & Platform Cards */}
      <div className="dashboard-grid">
        <article className="dashboard-card">
          <span>Customer</span>
          <strong style={{ fontSize: "14px" }}>{customer?.email ?? "Guest / No email"}</strong>
          {customer?.id && (
            <Link prefetch={false} href={`/admin/customers?q=${encodeURIComponent(customer.email ?? customer.id)}`} style={{ fontSize: "11px", color: "#60a5fa", marginTop: "4px" }}>
              View Customer Profile →
            </Link>
          )}
        </article>

        <article className="dashboard-card">
          <span>Public Order ID</span>
          <div>
            <CopyableValue label="Order ID" value={order.public_order_id} />
          </div>
        </article>

        <article className="dashboard-card">
          <span>Service & Platform</span>
          <strong>{service?.name ?? "—"}</strong>
          <small>{service?.platforms?.name ?? "—"}</small>
        </article>

        <article className="dashboard-card">
          <span>Target Destination</span>
          <div style={{ wordBreak: "break-all" }}>
            <CopyableValue label="Target" value={order.target_value} />
          </div>
          <small>Type: {order.target_type}</small>
        </article>

        <article className="dashboard-card">
          <span>Quantity & Total</span>
          <strong>{order.quantity.toLocaleString()} units</strong>
          <small>{order.total} {order.currency} (Unit: {order.unit_price})</small>
        </article>

        <article className="dashboard-card">
          <span>State Summary</span>
          <div style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "4px" }}>
            <span className={`admin-status ${order.payment_status.toLowerCase()}`}>{order.payment_status}</span>
            <span className={`admin-status ${order.fulfillment_status.toLowerCase()}`}>{order.fulfillment_status}</span>
          </div>
        </article>

        {latestProviderOrder?.provider_order_id && (
          <article className="dashboard-card">
            <span>ReliableSMM Order ID</span>
            <div>
              <CopyableValue label="Provider Order ID" value={latestProviderOrder.provider_order_id} />
            </div>
            <small>Status: {latestProviderOrder.status} | Remains: {latestProviderOrder.remains ?? "—"}</small>
          </article>
        )}

        {payments?.[0]?.reference && (
          <article className="dashboard-card">
            <span>Payment Reference</span>
            <div>
              <CopyableValue label="Payment Reference" value={payments[0].reference} />
            </div>
            <small>Method: {payments[0].provider}</small>
          </article>
        )}
      </div>

      {/* Failure Box if failed */}
      {order.failure_reason && (
        <div style={{ padding: "14px", borderRadius: "10px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}>
          <strong style={{ color: "#f87171", display: "block", marginBottom: "4px" }}>
            Fulfillment Failure: {order.failure_reason}
          </strong>
          <p style={{ color: "#fca5a5", fontSize: "12px", margin: 0 }}>
            {order.failure_detail || "No additional error detail recorded."}
          </p>
        </div>
      )}
    </div>
  );

  const targetInputsSection = (
    <>
      <div className="dashboard-card" style={{ marginBottom: "1.5rem" }}>
        <h2>Target</h2>
        <p className="order-input-value">{order.target_value}</p>
        <small>Target type: {order.target_type}</small>
      </div>
      <div className="dashboard-card">
        <h2>Saved order inputs</h2>
        {orderedInputValues.length ? (
          <dl className="order-inputs-list">
            {orderedInputValues.map(({ key, value, field }) => (
              <div key={key}>
                <dt>{field?.label ?? key}</dt>
                <dd>{formatOrderInputValue(value)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p>No custom dynamic input fields configured for this service.</p>
        )}
      </div>
    </>
  );

  const paymentsSection = (
    <div className="dashboard-card">
      <h2>Payment records</h2>
      {paymentsError ? (
        <AdminQueryError message="Payments could not be loaded." />
      ) : payments?.length ? (
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Reference</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => (
              <tr key={payment.id}>
                <td>{payment.provider}</td>
                <td><CopyableValue label="Reference" value={payment.reference} /></td>
                <td>{payment.amount} {payment.currency}</td>
                <td><span className={`admin-status ${payment.status.toLowerCase()}`}>{payment.status}</span></td>
                <td>{new Date(payment.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <AdminEmptyState message="No payment records found." />
      )}
    </div>
  );

  const fulfillmentSection = (
    <div className="dashboard-card">
      <h2>Provider submission attempts</h2>
      {providerOrdersError ? (
        <AdminQueryError message="Provider attempts could not be loaded." />
      ) : providerOrders?.length ? (
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Provider Order ID</th>
              <th>Status</th>
              <th>Attempt State</th>
              <th>Start / Remains</th>
              <th>Error</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {providerOrders.map((attempt) => (
              <tr key={attempt.id}>
                <td>{attempt.provider}</td>
                <td><CopyableValue label="Provider Order" value={attempt.provider_order_id} /></td>
                <td><span className={`admin-status ${(attempt.status ?? "unknown").toLowerCase()}`}>{attempt.status ?? "NOT_STARTED"}</span></td>
                <td>{attempt.attempt_status}</td>
                <td>{attempt.start_count ?? "—"} / {attempt.remains ?? "—"}</td>
                <td style={{ color: attempt.error_code || attempt.last_submission_error ? "#f87171" : "#aaa", fontSize: "11px" }}>
                  {attempt.error_code || attempt.last_submission_error || "—"}
                </td>
                <td>{new Date(attempt.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <AdminEmptyState message="No provider attempts found for this order." />
      )}
    </div>
  );

  const ledgerSection = (
    <div className="dashboard-card">
      <h2>Wallet ledger</h2>
      {walletEntriesError ? (
        <AdminQueryError message="Wallet entries for this order could not be loaded." />
      ) : walletEntries?.length ? (
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Direction</th>
              <th>Amount</th>
              <th>Reference</th>
            </tr>
          </thead>
          <tbody>
            {walletEntries.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.type}</td>
                <td>{entry.direction}</td>
                <td>{(Number(entry.amount_minor) / 100).toFixed(2)} GHS</td>
                <td><CopyableValue label="Ref" value={entry.reference} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <AdminEmptyState message="No wallet debit/refund entries found." />
      )}
    </div>
  );

  const eligibility = getRetryEligibility({
    id: order.id,
    payment_status: order.payment_status,
    fulfillment_status: order.fulfillment_status,
    failure_reason: order.failure_reason,
    provider_order_id: latestProviderOrder?.provider_order_id ?? null,
    attempt_status: latestProviderOrder?.attempt_status ?? null,
  });

  return (
    <>
      <header className="dashboard-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <p className="dashboard-kicker">ORDER OPERATIONS</p>
          <h1 style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {order.public_order_id}
            <span className={`admin-status ${order.fulfillment_status.toLowerCase()}`}>{order.fulfillment_status}</span>
            {order.failure_reason && (
              <span style={{ fontSize: "12px", background: "rgba(239,68,68,0.2)", color: "#f87171", padding: "2px 8px", borderRadius: "6px" }}>
                {order.failure_reason}
              </span>
            )}
          </h1>
          <p>{service?.platforms?.name ?? "—"} / {service?.name ?? "Service unavailable"}</p>
          <small style={{ color: "#aaa" }}>Created: {new Date(order.created_at).toLocaleString()}</small>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }}>
          {(eligibility.eligible || eligibility.canForce) && (
            <AdminOrderRetryAction
              orderId={order.id}
              publicOrderId={order.public_order_id}
              failureReason={order.failure_reason}
              canForce={eligibility.canForce}
              isEligible={eligibility.eligible}
            />
          )}
        </div>
      </header>

      {/* Admin Action Bar (Refresh status from provider, add admin notes, etc.) */}
      <AdminOrderActionsBar
        orderId={order.id}
        publicOrderId={order.public_order_id}
        hasProviderOrder={Boolean(latestProviderOrder?.provider_order_id)}
      />

      <div style={{ marginTop: "24px" }}>
        <AdminOrderDetailTabs
          overviewContent={overviewSection}
          targetInputsContent={targetInputsSection}
          paymentsContent={paymentsSection}
          fulfillmentContent={fulfillmentSection}
          ledgerContent={ledgerSection}
          timelineContent={timelineContent}
          paymentsCount={payments?.length ?? 0}
          fulfillmentCount={providerOrders?.length ?? 0}
          ledgerCount={walletEntries?.length ?? 0}
          eventsCount={timelineEvents.length}
        />
      </div>

      <div style={{ marginTop: "2rem" }}>
        <Link prefetch={false} href="/admin/orders">← Back to orders</Link>
      </div>
    </>
  );
}
