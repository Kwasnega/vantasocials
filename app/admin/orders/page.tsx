import Link from "next/link";
import { requireAdmin } from "../../../lib/admin/auth";
import { buildAdminOrderPageHref, escapePostgrestSearchTerm } from "../../../lib/admin/order-list";
import { createSupabaseAdminClient } from "../../../lib/supabase/server";
import { AdminEmptyState, AdminQueryError } from "../AdminDataState";

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; payment?: string; fulfillment?: string; page?: string }> }) {
  const { admin } = await requireAdmin();
  if (!admin) return null;
  const db = createSupabaseAdminClient();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const limit = 25;
  const search = (params.q ?? "").trim();
  let query = db.from("orders").select("public_order_id,target_value,quantity,total,currency,payment_status,fulfillment_status,created_at,profiles(email),services(name,platforms(name))", { count: "exact" });
  if (params.payment) query = query.eq("payment_status", params.payment);
  if (params.fulfillment) query = query.eq("fulfillment_status", params.fulfillment);
  if (search) {
    const escapedSearch = escapePostgrestSearchTerm(search);
    query = query.or(`public_order_id.ilike."%${escapedSearch}%",target_value.ilike."%${escapedSearch}%"`);
  }
  const { data: orders, count, error } = await query.order("created_at", { ascending: false }).range((page - 1) * limit, page * limit - 1);
  const pages = count === null ? null : Math.max(1, Math.ceil(count / limit));
  const currentPaid = (orders ?? []).filter((order) => order.payment_status === "PAID").length;
  const currentActive = (orders ?? []).filter((order) => ["PROCESSING", "SUBMITTING", "SUBMITTED"].includes(order.fulfillment_status)).length;
  return <div className="admin-orders-page orders-redesign">
    <header className="orders-hero"><div><p className="dashboard-kicker">ADMIN / OPERATIONS</p><h1>Orders<span>.</span></h1><p>Track customer purchases, payment state, and fulfillment progress from one clear queue.</p></div><div className="orders-hero-mark" aria-hidden="true">V</div></header>
    <section className="orders-stats">
      <article><span>Total orders</span>{error ? <AdminQueryError message="Total unavailable." /> : <strong>{count ?? "Unavailable"}</strong>}<small>All customer orders matching filters</small></article>
      <article><span>On this page</span>{error ? <AdminQueryError message="Page count unavailable." /> : <strong>{orders?.length ?? 0}</strong>}<small>Newest activity first</small></article>
      <article><span>Paid</span>{error ? <AdminQueryError message="Page count unavailable." /> : <strong>{currentPaid}</strong>}<small>Current page</small></article>
      <article><span>In progress</span>{error ? <AdminQueryError message="Page count unavailable." /> : <strong>{currentActive}</strong>}<small>Current page</small></article>
    </section>
    <section className="admin-orders-panel orders-redesign-panel">
      <div className="customers-panel-heading"><div><p className="dashboard-kicker">ORDER QUEUE</p><h2>All orders</h2></div><span>{error ? "Count unavailable" : `${count ?? "unknown"} records`}</span></div>
      <form className="admin-order-filters orders-filter-bar"><label>Filter orders</label><div className="orders-filter-row">
        <input name="q" defaultValue={search} placeholder="Order ID or target"/>
        <select name="payment" defaultValue={params.payment ?? ""}><option value="">All payment states</option>{["UNPAID", "PENDING", "PAID", "FAILED", "REFUNDED"].map((status) => <option key={status}>{status}</option>)}</select>
        <select name="fulfillment" defaultValue={params.fulfillment ?? ""}><option value="">All fulfillment states</option>{["NOT_STARTED", "SUBMITTING", "SUBMITTED", "PROCESSING", "COMPLETED", "PARTIAL", "FAILED", "CANCELLED"].map((status) => <option key={status}>{status}</option>)}</select>
        <button type="submit">Apply filters <b>↗</b></button>
      </div></form>
      {error ? <AdminQueryError message="Orders could not be loaded. No empty-order state is being shown." /> : orders?.length ? <div className="dashboard-table-wrap"><table className="dashboard-table admin-orders-table"><thead><tr><th>Order</th><th>Customer</th><th>Service</th><th>Target</th><th>Qty</th><th>Total</th><th>Payment</th><th>Fulfillment</th><th></th></tr></thead><tbody>
          {orders.map((order) => <tr key={order.public_order_id}><td><Link href={`/admin/orders/${order.public_order_id}`}>{order.public_order_id}</Link><small>{new Date(order.created_at).toLocaleDateString()}</small></td><td>{(order.profiles as { email?: string } | null)?.email ?? "—"}</td><td><strong>{(order.services as { name?: string } | null)?.name ?? "—"}</strong><small>{(order.services as { platforms?: { name?: string } | null } | null)?.platforms?.name ?? "—"}</small></td><td>{order.target_value}</td><td>{order.quantity.toLocaleString()}</td><td>{order.total} {order.currency}</td><td><span className={`admin-status ${order.payment_status.toLowerCase()}`}>{order.payment_status}</span></td><td><span className={`admin-status ${order.fulfillment_status.toLowerCase()}`}>{order.fulfillment_status}</span></td><td><Link className="admin-row-action" href={`/admin/orders/${order.public_order_id}`}>Open →</Link></td></tr>)}
        </tbody></table></div> : count === 0 ? <AdminEmptyState message="No matching orders. Try adjusting the filters or search term." /> : <AdminEmptyState message="No orders are present on this page. Use the previous-page control to return to available results." />}
      {!error && count !== 0 && <nav className="admin-pagination" aria-label="Order pages"><span>Page {page} of {pages ?? "unknown"}</span><div>{page > 1 ? <Link aria-label="Previous orders page" href={buildAdminOrderPageHref(page - 1, search, params.payment, params.fulfillment)}>← Previous</Link> : <span aria-disabled="true">← Previous</span>}{pages !== null && page < pages ? <Link aria-label="Next orders page" href={buildAdminOrderPageHref(page + 1, search, params.payment, params.fulfillment)}>Next →</Link> : <span aria-disabled="true">Next →</span>}</div></nav>}
    </section>
  </div>;
}
