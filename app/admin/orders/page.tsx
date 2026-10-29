import Link from "next/link";
import { requireAdmin } from "../../../lib/admin/auth";
import { escapePostgrestSearchTerm } from "../../../lib/admin/order-list";
import { createSupabaseAdminClient } from "../../../lib/supabase/server";
import { AdminEmptyState, AdminQueryError } from "../AdminDataState";
import { AdminFilterBar } from "../../../components/admin/AdminFilterBar";
import { parseOrderCursor } from "../../../lib/admin/cursor-validation";

/** Build an orders page href including a cursor (for keyset pagination) */
function buildOrdersHref(search: string, payment?: string, fulfillment?: string, cursor?: string): string {
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  if (payment) params.set("payment", payment);
  if (fulfillment) params.set("fulfillment", fulfillment);
  if (cursor) params.set("cursor", cursor);
  return `/admin/orders?${params.toString()}`;
}

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; payment?: string; fulfillment?: string; cursor?: string }> }) {
  const { admin } = await requireAdmin();
  if (!admin) return null;
  const db = createSupabaseAdminClient();
  const params = await searchParams;
  const limit = 25;
  const search = (params.q ?? "").trim();
  const isFiltered = Boolean(search || params.payment || params.fulfillment);
  const countStrategy = isFiltered ? "exact" : "planned";

  // Keyset/cursor pagination with strict server-side validation
  let cursorCreatedAt: string | null = null;
  let cursorId: string | null = null;
  if (params.cursor) {
    try {
      const validated = parseOrderCursor(params.cursor);
      if (validated) {
        cursorCreatedAt = validated.createdAt;
        cursorId = validated.id;
      }
    } catch {
      return (
        <div className="admin-orders-page orders-redesign">
          <header className="orders-hero"><h1>Invalid Cursor</h1></header>
          <AdminQueryError message="The pagination cursor is malformed or invalid. Please return to the first page." />
          <Link href="/admin/orders" style={{ marginTop: "1rem", display: "inline-block" }}>← Return to start</Link>
        </div>
      );
    }
  }

  let query = db.from("orders").select("public_order_id,target_value,quantity,total,currency,payment_status,fulfillment_status,created_at,profiles(email),services(name,platforms(name))", { count: countStrategy });
  if (params.payment) query = query.eq("payment_status", params.payment);
  if (params.fulfillment) query = query.eq("fulfillment_status", params.fulfillment);
  if (search) {
    const escapedSearch = escapePostgrestSearchTerm(search);
    query = query.or(`public_order_id.ilike."%${escapedSearch}%",target_value.ilike."%${escapedSearch}%"`);
  }
  // Keyset filter: rows older than cursor
  if (cursorCreatedAt && cursorId) {
    query = query.or(`created_at.lt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},public_order_id.lt.${cursorId})`);
  }
  const { data: orders, count, error } = await query
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 100));

  const currentPaid = (orders ?? []).filter((order) => order.payment_status === "PAID").length;
  const currentActive = (orders ?? []).filter((order) => ["PROCESSING", "SUBMITTING", "SUBMITTED"].includes(order.fulfillment_status)).length;

  // Build next cursor from the last row returned
  const hasNextPage = (orders?.length ?? 0) === limit;
  const lastOrder = orders?.at(-1);
  const nextCursor = hasNextPage && lastOrder
    ? Buffer.from(JSON.stringify({ created_at: lastOrder.created_at, id: lastOrder.public_order_id })).toString("base64")
    : null;

  // Count display label
  const countLabel = error ? "Count unavailable" : count === null ? "unknown records" : isFiltered ? `${count} records` : `~${count} records`;

  return <div className="admin-orders-page orders-redesign">
    <header className="orders-hero"><div><p className="dashboard-kicker">ADMIN / OPERATIONS</p><h1>Orders<span>.</span></h1><p>Track customer purchases, payment state, and fulfillment progress from one clear queue.</p></div><div className="orders-hero-mark" aria-hidden="true">V</div></header>
    <section className="orders-stats">
      <article><span>Total orders</span>{error ? <AdminQueryError message="Total unavailable." /> : <strong>{count === null ? "Unavailable" : isFiltered ? count : `~${count}`}</strong>}<small>All customer orders matching filters</small></article>
      <article><span>On this page</span>{error ? <AdminQueryError message="Page count unavailable." /> : <strong>{orders?.length ?? 0}</strong>}<small>Newest activity first</small></article>
      <article><span>Paid</span>{error ? <AdminQueryError message="Page count unavailable." /> : <strong>{currentPaid}</strong>}<small>Current page</small></article>
      <article><span>In progress</span>{error ? <AdminQueryError message="Page count unavailable." /> : <strong>{currentActive}</strong>}<small>Current page</small></article>
    </section>
    <section className="admin-orders-panel orders-redesign-panel">
      <div className="customers-panel-heading"><div><p className="dashboard-kicker">ORDER QUEUE</p><h2>All orders</h2></div><span>{countLabel}</span></div>
      <AdminFilterBar
        initialSearch={search}
        searchPlaceholder="Order ID or target"
        selects={[
          {
            name: "payment",
            defaultValue: params.payment ?? "",
            options: [
              { value: "", label: "All payment states" },
              ...["UNPAID", "PENDING", "PAID", "FAILED", "REFUNDED"].map((s) => ({ value: s, label: s })),
            ],
          },
          {
            name: "fulfillment",
            defaultValue: params.fulfillment ?? "",
            options: [
              { value: "", label: "All fulfillment states" },
              ...["NOT_STARTED", "SUBMITTING", "SUBMITTED", "PROCESSING", "COMPLETED", "PARTIAL", "FAILED", "CANCELLED"].map((s) => ({ value: s, label: s })),
            ],
          },
        ]}
      />
      {error ? <AdminQueryError message="Orders could not be loaded. No empty-order state is being shown." /> : orders?.length ? <div className="dashboard-table-wrap"><table className="dashboard-table admin-orders-table"><thead><tr><th>Order</th><th>Customer</th><th>Service</th><th>Target</th><th>Qty</th><th>Total</th><th>Payment</th><th>Fulfillment</th><th></th></tr></thead><tbody>
          {orders.map((order) => <tr key={order.public_order_id}><td><Link prefetch={false} href={`/admin/orders/${order.public_order_id}`}>{order.public_order_id}</Link><small>{new Date(order.created_at).toLocaleDateString()}</small></td><td>{(order.profiles as { email?: string } | null)?.email ?? "—"}</td><td><strong>{(order.services as { name?: string } | null)?.name ?? "—"}</strong><small>{(order.services as { platforms?: { name?: string } | null } | null)?.platforms?.name ?? "—"}</small></td><td>{order.target_value}</td><td>{order.quantity.toLocaleString()}</td><td>{order.total} {order.currency}</td><td><span className={`admin-status ${order.payment_status.toLowerCase()}`}>{order.payment_status}</span></td><td><span className={`admin-status ${order.fulfillment_status.toLowerCase()}`}>{order.fulfillment_status}</span></td><td><Link prefetch={false} className="admin-row-action" href={`/admin/orders/${order.public_order_id}`}>Open →</Link></td></tr>)}
        </tbody></table></div> : count === 0 ? <AdminEmptyState message="No matching orders. Try adjusting the filters or search term." /> : <AdminEmptyState message="No orders are present on this page. Use the previous-page control to return to available results." />}
      {!error && count !== 0 && (
        <nav className="admin-pagination" aria-label="Order pages">
          <div>
            {nextCursor ? <Link aria-label="Next orders page" href={buildOrdersHref(search, params.payment, params.fulfillment, nextCursor)}>Next →</Link> : <span aria-disabled="true">Next →</span>}
          </div>
        </nav>
      )}
    </section>
  </div>;
}
