import Link from "next/link";
import { requireAdmin } from "../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../lib/supabase/server";
import { AdminEmptyState, AdminQueryError } from "../AdminDataState";

type StuckOrder = {
  id: string;
  public_order_id: string;
  total: number | string;
  currency: string;
  payment_status: string;
  fulfillment_status: string;
  created_at: string;
  profiles: { email?: string } | null;
  services: { name?: string; slug?: string } | null;
  provider_order_events?: Array<{
    event_type: string;
    error_code: string | null;
    created_at: string;
  }>;
};

export default async function AdminFulfillmentPage() {
  const { admin } = await requireAdmin();
  if (!admin) return null;
  const db = createSupabaseAdminClient();

  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  const [
    pending,
    processing,
    unknown,
    failed,
    completed,
    { data: stuckOrders, error: stuckOrdersError },
  ] = await Promise.all([
    db.from("provider_orders").select("id", { count: "exact", head: true }).in("status", ["NOT_STARTED", "SUBMITTING"]),
    db.from("provider_orders").select("id", { count: "exact", head: true }).in("status", ["SUBMITTED", "PROCESSING"]),
    db.from("provider_orders").select("id", { count: "exact", head: true }).eq("attempt_status", "UNKNOWN_PENDING_RECONCILIATION"),
    db.from("provider_orders").select("id", { count: "exact", head: true }).eq("status", "FAILED"),
    db.from("provider_orders").select("id", { count: "exact", head: true }).eq("status", "COMPLETED"),
    db.from("orders")
      .select("id,public_order_id,total,currency,payment_status,fulfillment_status,created_at,profiles(email),services(name,slug),provider_order_events(event_type,error_code,created_at)")
      .eq("payment_status", "PAID")
      .in("fulfillment_status", ["NOT_STARTED", "SUBMITTING"])
      .lte("created_at", twoMinutesAgo)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const metrics = [
    ["Needs attention", { count: stuckOrders?.length ?? 0, error: stuckOrdersError }],
    ["Pending", pending],
    ["Submitted / processing", processing],
    ["Reconciliation", unknown],
    ["Failed", failed],
    ["Completed", completed],
  ] as const;

  const typedStuckOrders = (stuckOrders ?? []) as unknown as StuckOrder[];

  return (
    <>
      <header className="dashboard-header">
        <p className="dashboard-kicker">OPERATIONS / FULFILLMENT</p>
        <h1>Fulfillment Queue</h1>
        <p>Live status of automated provider fulfillment, pending jobs, and orders requiring intervention.</p>
      </header>

      <div className="dashboard-grid">
        {metrics.map(([label, result]) => (
          <article className="dashboard-card" key={label}>
            <span>{label}</span>
            {result.error ? (
              <AdminQueryError message={`${label} count unavailable.`} />
            ) : (
              <strong style={label === "Needs attention" && (result.count ?? 0) > 0 ? { color: "#ff6b81" } : undefined}>
                {result.count ?? "0"}
              </strong>
            )}
          </article>
        ))}
      </div>

      <section className="admin-orders-panel" style={{ marginTop: 24 }}>
        <div className="customers-panel-heading">
          <div>
            <p className="dashboard-kicker" style={{ color: "#ff6b81" }}>ALERTS</p>
            <h2>Orders Needing Attention (Paid & Unsubmitted &gt; 2 min)</h2>
          </div>
          <span>{typedStuckOrders.length} orders</span>
        </div>

        {stuckOrdersError ? (
          <AdminQueryError message="Could not load orders needing attention." />
        ) : typedStuckOrders.length === 0 ? (
          <AdminEmptyState message="All paid orders are either fulfilled or in progress. No stuck orders detected." />
        ) : (
          <div className="dashboard-table-wrap">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Service</th>
                  <th>Age</th>
                  <th>Fulfillment Status</th>
                  <th>Latest Dispatch Reason</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {typedStuckOrders.map((order) => {
                  const events = order.provider_order_events ?? [];
                  const latestEvent = events.length > 0
                    ? [...events].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
                    : null;
                  const reason = latestEvent
                    ? `${latestEvent.event_type}${latestEvent.error_code ? `: ${latestEvent.error_code}` : ""}`
                    : "Unsubmitted / no event logged";

                  const ageMinutes = Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000);
                  const ageText = ageMinutes < 60 ? `${ageMinutes}m ago` : `${Math.floor(ageMinutes / 60)}h ${ageMinutes % 60}m ago`;

                  return (
                    <tr key={order.public_order_id}>
                      <td>
                        <Link prefetch={false} href={`/admin/orders/${order.public_order_id}`}>
                          {order.public_order_id}
                        </Link>
                      </td>
                      <td>{order.profiles?.email ?? "—"}</td>
                      <td>{order.services?.name ?? "—"}</td>
                      <td>{ageText}</td>
                      <td>
                        <span className={`admin-status ${order.fulfillment_status.toLowerCase()}`}>
                          {order.fulfillment_status}
                        </span>
                      </td>
                      <td style={{ color: "#ffb86c", fontSize: 13, fontFamily: "monospace" }}>
                        {reason}
                      </td>
                      <td>
                        <Link prefetch={false} className="admin-row-action" href={`/admin/orders/${order.public_order_id}`}>
                          Inspect →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
