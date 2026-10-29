import Link from "next/link";
import { requireUser } from "../../../lib/auth/require-user";
import { formatOrderInputValue } from "../../../lib/orders/display-input-values";
import { escapePostgrestSearchTerm } from "../../../lib/admin/order-list";
import { getPlatformLogoUrl } from "../../../lib/catalog/logo";

const statuses = ["ALL", "UNPAID", "PAID", "PROCESSING", "COMPLETED", "PARTIAL", "CANCELLED", "FAILED"];

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function AccountOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string; date?: string }>;
}) {
  const { user, db } = await requireUser("/account/orders");
  const params = await searchParams;
  const status = statuses.includes((params.status ?? "ALL").toUpperCase())
    ? (params.status ?? "ALL").toUpperCase()
    : "ALL";
  const q = (params.q ?? "").trim();
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const limit = 10;
  const date = ["30", "90", "all"].includes(params.date ?? "") ? params.date ?? "30" : "30";

  let query = db.from("orders")
    .select("public_order_id,target_value,input_values,quantity,unit_price,total,currency,status,payment_status,fulfillment_status,created_at,updated_at,services(name,platforms(name,slug))", { count: "exact" })
    .eq("user_id", user.id);
  if (status === "UNPAID") query = query.eq("payment_status", "UNPAID");
  else if (status === "PAID") query = query.eq("payment_status", "PAID");
  else if (status === "PROCESSING") query = query.in("fulfillment_status", ["PROCESSING", "SUBMITTING", "SUBMITTED"]);
  else if (["COMPLETED", "PARTIAL", "CANCELLED", "FAILED"].includes(status)) {
    query = query.eq("fulfillment_status", status);
  }
  if (date !== "all") {
    query = query.gte("created_at", new Date(Date.now() - Number(date) * 24 * 60 * 60 * 1000).toISOString());
  }
  if (q) {
    const escapedQ = escapePostgrestSearchTerm(q);
    let serviceIds = "";
    if (q.length >= 3) {
      const { data: matchingServices, error: serviceSearchError } = await db.from("services")
        .select("id")
        .ilike("name", `%${q}%`)
        .limit(50);
      if (serviceSearchError) throw serviceSearchError;
      serviceIds = (matchingServices ?? []).map((service) => service.id).join(",");
    }
    const parts = [`public_order_id.ilike."%${escapedQ}%"`, `target_value.ilike."%${escapedQ}%"`];
    if (serviceIds) parts.push(`service_id.in.(${serviceIds})`);
    query = query.or(parts.join(","));
  }

  const { data: orders, count, error: ordersError } = await query.order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (ordersError) throw ordersError;

  const pageCount = Math.max(1, Math.ceil((count ?? 0) / limit));
  const firstOrder = count ? (page - 1) * limit + 1 : 0;
  const lastOrder = Math.min(page * limit, count ?? 0);
  const pageHref = (pageNumber: number) =>
    `/account/orders?status=${status}&q=${encodeURIComponent(q)}&date=${date}&page=${pageNumber}`;

  return (
    <>
      <header className="dashboard-header orders-header">
        <p className="dashboard-kicker">ACCOUNT / ORDERS</p>
        <h1>Your orders</h1>
        <p>Track every order, payment, and fulfillment update in one place.</p>
      </header>

      <form className="orders-filters">
        <label className="orders-search">
          <span aria-hidden="true">⌕</span>
          <input name="q" defaultValue={q} placeholder="Search by order ID or target" />
        </label>
        <label>
          <span>Status</span>
          <select name="status" defaultValue={status}>
            {statuses.map((item) => (
              <option key={item} value={item}>{item === "ALL" ? "All" : formatStatus(item)}</option>
            ))}
          </select>
        </label>
        <label className="orders-date">
          <span>Date</span>
          <select name="date" defaultValue={date}>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="all">All time</option>
          </select>
        </label>
        <button type="submit">Apply filters</button>
      </form>

      <section className="orders-panel">
        <div className="orders-panel-heading">
          <div>
            <span className="catalog-eyebrow">ORDER HISTORY</span>
            <h2>Your orders</h2>
          </div>
          <span className="orders-total">{count ?? 0} total</span>
        </div>

        <div className="dashboard-table-wrap orders-desktop-table">
          <table className="dashboard-table orders-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Service / platform</th>
                <th>Target</th>
                <th>Quantity</th>
                <th>Total</th>
                <th>Payment</th>
                <th>Fulfillment</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {(orders ?? []).map((order) => {
                const inputs = order.input_values && typeof order.input_values === "object" && !Array.isArray(order.input_values)
                  ? Object.entries(order.input_values as Record<string, unknown>)
                  : [];
                const service = order.services as { name?: string; platforms?: { name?: string; slug?: string } | null } | null;
                const paymentStatus = formatStatus(order.payment_status);
                const fulfillmentStatus = formatStatus(order.fulfillment_status);
                return (
                  <tr key={order.public_order_id}>
                    <td><Link href={`/account/orders/${order.public_order_id}`}>{order.public_order_id}</Link></td>
                    <td>
                      <span className="orders-service">
                        <strong>{service?.name ?? "Service"}</strong>
                        <small>{service?.platforms?.name ?? "—"}</small>
                      </span>
                    </td>
                    <td>
                      {inputs.length === 0
                        ? order.target_value
                        : (
                          <span className="order-history-inputs">
                            {inputs.map(([key, value]) => (
                              <span key={key}>{key.replaceAll("_", " ")}: {formatOrderInputValue(value)}</span>
                            ))}
                          </span>
                        )}
                    </td>
                    <td>{order.quantity.toLocaleString()}</td>
                    <td>{order.total} {order.currency}</td>
                    <td><span className={`order-status ${order.payment_status.toLowerCase()}`}>{paymentStatus}</span></td>
                    <td><span className={`order-status ${order.fulfillment_status.toLowerCase().replaceAll("_", "-")}`}>{fulfillmentStatus}</span></td>
                    <td>{new Date(order.created_at).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="orders-mobile-list">
          {(orders ?? []).map((order) => {
            const inputs = order.input_values && typeof order.input_values === "object" && !Array.isArray(order.input_values)
              ? Object.entries(order.input_values as Record<string, unknown>)
              : [];
            const service = order.services as { name?: string; platforms?: { name?: string; slug?: string } | null } | null;
            const platformLogoUrl = service?.platforms?.slug
              ? getPlatformLogoUrl(service.platforms.slug)
              : null;
            const target = inputs.length === 0
              ? order.target_value
              : formatOrderInputValue(inputs[0][1]);
            const paymentStatus = formatStatus(order.payment_status);
            const fulfillmentStatus = formatStatus(order.fulfillment_status);
            return (
              <Link
                className="orders-mobile-card"
                href={`/account/orders/${order.public_order_id}`}
                key={order.public_order_id}
              >
                <div className="orders-mobile-card-top">
                  <div>
                    <span className="orders-mobile-eyebrow">ORDER</span>
                    <span className="orders-mobile-id">
                      {order.public_order_id} <span aria-hidden="true">↗</span>
                    </span>
                  </div>
                  <strong className="orders-mobile-total">{order.total} <small>{order.currency}</small></strong>
                </div>
                <div className="orders-mobile-service">
                  <span className="orders-mobile-service-mark">
                    {platformLogoUrl
                      ? <img src={platformLogoUrl} alt={`${service?.platforms?.name ?? "Platform"} logo`} loading="lazy" />
                      : <span aria-hidden="true">◇</span>}
                  </span>
                  <div>
                    <strong>{service?.name ?? "VANTA service"}</strong>
                    <span>{service?.platforms?.name ?? "Platform"}</span>
                  </div>
                </div>
                <div className="orders-mobile-target">
                  <span>Target</span>
                  <strong>{target}</strong>
                </div>
                <div className="orders-mobile-card-bottom">
                  <div className="orders-mobile-badges">
                    <span className={`order-status ${order.payment_status.toLowerCase()}`}>{paymentStatus}</span>
                    <span className={`order-status ${order.fulfillment_status.toLowerCase().replaceAll("_", "-")}`}>{fulfillmentStatus}</span>
                  </div>
                  <div className="orders-mobile-meta">
                    <span>Qty {order.quantity.toLocaleString()}</span>
                    <time dateTime={order.created_at}>{new Date(order.created_at).toLocaleDateString()}</time>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {(orders ?? []).length === 0 && (
          <div className="orders-empty">
            <div className="empty-icon">V</div>
            <h3>No orders found</h3>
            <p>{q || status !== "ALL" || date !== "30"
              ? "Try changing your search or filters to find an order."
              : "Your order history will appear here once you place your first order."}</p>
            {q || status !== "ALL" || date !== "30"
              ? <Link href="/account/orders">Clear filters <b>↗</b></Link>
              : <Link href="/new-order">Create a new order <b>↗</b></Link>}
          </div>
        )}

        <nav className="orders-pagination" aria-label="Orders pagination">
          <span>Showing {firstOrder}–{lastOrder} of {count ?? 0} orders</span>
          <div>
            {page > 1
              ? <Link href={pageHref(page - 1)} aria-label="Previous page">← <span>Previous</span></Link>
              : <span className="is-disabled" aria-disabled="true">← <span>Previous</span></span>}
            {page < pageCount
              ? <Link href={pageHref(page + 1)} aria-label="Next page"><span>Next</span> →</Link>
              : <span className="is-disabled" aria-disabled="true"><span>Next</span> →</span>}
          </div>
        </nav>
      </section>
    </>
  );
}
