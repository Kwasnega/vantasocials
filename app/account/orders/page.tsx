import Link from "next/link";
import { requireUser } from "../../../lib/auth/require-user";

const statuses = ["ALL", "UNPAID", "PAID", "PROCESSING", "COMPLETED", "PARTIAL", "CANCELLED", "FAILED"];
export default async function AccountOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; page?: string }> }) {
  const { user, db } = await requireUser("/account/orders"); const params = await searchParams;
  const status = statuses.includes((params.status ?? "ALL").toUpperCase()) ? (params.status ?? "ALL").toUpperCase() : "ALL";
  const q = (params.q ?? "").trim(); const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1); const limit = 20;
  let query = db.from("orders").select("public_order_id,target_value,quantity,unit_price,total,currency,status,payment_status,fulfillment_status,created_at,updated_at,services(name,platforms(name))", { count: "exact" }).eq("user_id", user.id);
  if (status === "UNPAID") query = query.eq("payment_status", "UNPAID"); else if (status === "PAID") query = query.eq("payment_status", "PAID"); else if (status === "PROCESSING") query = query.eq("fulfillment_status", "PROCESSING"); else if (["COMPLETED", "PARTIAL", "CANCELLED", "FAILED"].includes(status)) query = query.eq("fulfillment_status", status);
  if (q) {
    const { data: matchingServices } = await db.from("services").select("id").ilike("name", `%${q}%`).limit(50);
    const serviceIds = (matchingServices ?? []).map((service) => service.id).join(",");
    const parts = [`public_order_id.ilike.%${q}%`, `target_value.ilike.%${q}%`];
    if (serviceIds) parts.push(`service_id.in.(${serviceIds})`);
    query = query.or(parts.join(","));
  }
  const { data: orders, count } = await query.order("created_at", { ascending: false }).range((page - 1) * limit, page * limit - 1);
  const pageCount = Math.max(1, Math.ceil((count ?? 0) / limit));
  return <><header className="dashboard-header"><p className="dashboard-kicker">ORDERS</p><h1>Your orders.</h1></header><form className="dashboard-actions"><input name="q" defaultValue={q} placeholder="Search order ID or target"/><select name="status" defaultValue={status}>{statuses.map((item) => <option key={item} value={item}>{item === "ALL" ? "All" : item}</option>)}</select><button type="submit">Filter</button></form><div className="dashboard-card"><div className="dashboard-table-wrap"><table className="dashboard-table"><thead><tr><th>Order</th><th>Service / platform</th><th>Target</th><th>Quantity</th><th>Total</th><th>Payment</th><th>Fulfillment</th><th>Created</th></tr></thead><tbody>{(orders ?? []).map((order) => <tr key={order.public_order_id}><td><Link href={`/account/orders/${order.public_order_id}`}>{order.public_order_id}</Link></td><td>{(order.services as { name?: string; platforms?: { name?: string } | null } | null)?.name ?? "Service"} / {(order.services as { platforms?: { name?: string } | null } | null)?.platforms?.name ?? "—"}</td><td>{order.target_value}</td><td>{order.quantity}</td><td>{order.total} {order.currency}</td><td>{order.payment_status}</td><td>{order.fulfillment_status}</td><td>{new Date(order.created_at).toLocaleDateString()}</td></tr>)}</tbody></table></div>{(orders ?? []).length === 0 && <p>No orders match this view.</p>}<p>Page {page} of {pageCount}</p><div className="dashboard-actions">{page > 1 && <Link href={`/account/orders?status=${status}&q=${encodeURIComponent(q)}&page=${page - 1}`}>Previous</Link>}{page < pageCount && <Link href={`/account/orders?status=${status}&q=${encodeURIComponent(q)}&page=${page + 1}`}>Next</Link>}</div></div></>;
}
