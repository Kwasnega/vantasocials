import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../lib/supabase/server";
import { formatOrderInputValue } from "../../../../lib/orders/display-input-values";
import { AdminEmptyState, AdminQueryError } from "../../AdminDataState";
import { AdminOrderDetailTabs } from "../../../../components/admin/AdminOrderDetailTabs";

export default async function AdminOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { admin } = await requireAdmin();
  if (!admin) return null;
  const { id } = await params;
  const db = createSupabaseAdminClient();
  const { data: order, error: orderError } = await db.from("orders").select("id,public_order_id,target_type,target_value,quantity,unit_price,subtotal,total,currency,status,payment_status,fulfillment_status,created_at,updated_at,input_schema_snapshot,input_values,services(name,slug,platforms(name))").eq("public_order_id", id).maybeSingle();
  if (orderError) return <AdminQueryError message="Order details could not be loaded." />;
  if (!order) notFound();
  const [
    { data: payments, error: paymentsError },
    { data: walletEntries, error: walletEntriesError },
    { data: providerOrders, error: providerOrdersError },
  ] = await Promise.all([
    db.from("payments").select("id,provider,reference,amount,currency,status,paid_at,created_at").eq("order_id", order.id).order("created_at", { ascending: false }).limit(10),
    db.from("wallet_transactions").select("id,type,direction,status,amount_minor,reference,created_at").eq("order_id", order.id).limit(10),
    db.from("provider_orders").select("id,provider,provider_order_id,provider_service_id,status,attempt_status,error_code,created_at,updated_at").eq("order_id", order.id).order("created_at", { ascending: false }).limit(10),
  ]);
  const service = order.services as { name?: string; slug?: string; platforms?: { name?: string } | null } | null;
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

  const overviewSection = (
    <div className="dashboard-grid">
      {[
        ["Internal order ID", order.id],
        ["Public order ID", order.public_order_id],
        ["Quantity", order.quantity],
        ["Customer unit-price snapshot", `${order.unit_price} ${order.currency}`],
        ["Subtotal snapshot", `${order.subtotal} ${order.currency}`],
        ["Total snapshot", `${order.total} ${order.currency}`],
        ["Payment state", order.payment_status],
        ["Fulfillment state", order.fulfillment_status],
        ["Created", new Date(order.created_at).toLocaleString()],
        ["Updated", new Date(order.updated_at).toLocaleString()],
      ].map(([label, value]) => (
        <article className="dashboard-card" key={String(label)}>
          <span>{label}</span>
          <strong>{value}</strong>
        </article>
      ))}
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
          <div className="dashboard-grid">
            {orderedInputValues.map(({ key, value, field }) => (
              <article className="dashboard-card" key={key}>
                <span>{field?.label ?? key.replaceAll("_", " ")}</span>
                <strong className="order-input-value">{formatOrderInputValue(value)}</strong>
              </article>
            ))}
          </div>
        ) : (
          <AdminEmptyState message="No saved dynamic input values are recorded for this order." />
        )}
      </div>
    </>
  );

  const paymentsSection = (
    <div className="dashboard-card">
      <h2>Payments</h2>
      {paymentsError ? (
        <AdminQueryError message="Payment history for this order could not be loaded." />
      ) : payments?.length ? (
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Reference</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Paid</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => (
              <tr key={payment.id}>
                <td>{payment.provider}</td>
                <td>{payment.reference}</td>
                <td>{payment.amount} {payment.currency}</td>
                <td>{payment.status}</td>
                <td>{payment.paid_at ? new Date(payment.paid_at).toLocaleString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <AdminEmptyState message="No payment records found for this order." />
      )}
    </div>
  );

  const fulfillmentSection = (
    <div className="dashboard-card">
      <h2>Fulfillment visibility</h2>
      <p>Provider submission remains disabled in this phase.</p>
      {providerOrdersError ? (
        <AdminQueryError message="Provider attempt history could not be loaded." />
      ) : providerOrders?.length ? (
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Provider service ID</th>
              <th>VANTA provider-attempt ID</th>
              <th>External provider order ID</th>
              <th>Attempt state</th>
              <th>Provider state</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {providerOrders.map((item) => (
              <tr key={item.id}>
                <td>{item.provider}</td>
                <td>{item.provider_service_id}</td>
                <td>{item.id}</td>
                <td>{item.provider_order_id ?? "—"}</td>
                <td>{item.attempt_status ?? "—"}</td>
                <td>{item.status}</td>
                <td>{item.error_code ?? "—"}</td>
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
                <td>{entry.reference}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <AdminEmptyState message="No wallet debit/refund entries found." />
      )}
    </div>
  );

  return (
    <>
      <header className="dashboard-header">
        <p className="dashboard-kicker">ORDER OPERATIONS</p>
        <h1>{order.public_order_id}</h1>
        <p>{service?.platforms?.name ?? "—"} / {service?.name ?? "Service unavailable"}</p>
      </header>

      <AdminOrderDetailTabs
        overviewContent={overviewSection}
        targetInputsContent={targetInputsSection}
        paymentsContent={paymentsSection}
        fulfillmentContent={fulfillmentSection}
        ledgerContent={ledgerSection}
        paymentsCount={payments?.length ?? 0}
        fulfillmentCount={providerOrders?.length ?? 0}
        ledgerCount={walletEntries?.length ?? 0}
      />

      <div style={{ marginTop: "2rem" }}>
        <Link prefetch={false} href="/admin/orders">← Back to orders</Link>
      </div>
    </>
  );
}
