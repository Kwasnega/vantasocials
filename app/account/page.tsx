import Link from "next/link";
import { requireUser } from "../../lib/auth/require-user";

export default async function AccountPage() {
  const { user, db } = await requireUser("/account");
  const [{ data: wallet }, { count: totalOrders }, { count: completedOrders }, { count: processingOrders }, { count: pendingOrders }, { data: spend }, { data: recentOrders }] = await Promise.all([
    db.from("wallets").select("balance_minor,currency").eq("user_id", user.id).maybeSingle(),
    db.from("orders").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    db.from("orders").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("fulfillment_status", "COMPLETED"),
    db.from("orders").select("id", { count: "exact", head: true }).eq("user_id", user.id).in("fulfillment_status", ["PROCESSING", "SUBMITTING", "SUBMITTED"]),
    db.from("orders").select("id", { count: "exact", head: true }).eq("user_id", user.id).or("payment_status.eq.UNPAID,payment_status.eq.PENDING,fulfillment_status.eq.FAILED"),
    db.from("orders").select("total,currency").eq("user_id", user.id).eq("payment_status", "PAID"),
    db.from("orders").select("public_order_id,total,currency,payment_status,fulfillment_status,created_at,services(name,platforms(name))").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5),
  ]);
  const spent = (spend ?? []).reduce((sum, order) => sum + Number(order.total || 0), 0).toFixed(2);
  const balance = (Number(wallet?.balance_minor ?? 0) / 100).toFixed(2);
  return <><header className="dashboard-header"><p className="dashboard-kicker">ACCOUNT OVERVIEW</p><h1>Welcome back.</h1><p>{user.email}</p></header>
    <div className="dashboard-actions"><Link className="service-action-link" href="/account/wallet">Quick deposit</Link><Link className="service-action-link" href="/new-order">New order</Link></div>
    <div className="dashboard-grid">{[["Wallet balance", `${balance} ${wallet?.currency ?? "GHS"}`],["Total orders", totalOrders ?? 0],["Completed", completedOrders ?? 0],["Processing", processingOrders ?? 0],["Pending / failed", pendingOrders ?? 0],["Total spent", `${spent} GHS`]].map(([label,value]) => <article className="dashboard-card" key={String(label)}><span>{label}</span><strong>{value}</strong></article>)}</div>
    <div className="dashboard-card"><div className="dashboard-card-heading"><h2>Recent orders</h2><Link href="/account/orders">View all</Link></div>{(recentOrders ?? []).length === 0 ? <p>No orders yet.</p> : <ul className="dashboard-list">{recentOrders?.map((order) => <li key={order.public_order_id}><Link href={`/account/orders/${order.public_order_id}`}>{order.public_order_id}</Link><span>{order.total} {order.currency} · {order.payment_status} / {order.fulfillment_status}</span></li>)}</ul>}</div></>;
}
