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
  return <div className="overview-page"><header className="dashboard-header overview-header"><div><p className="dashboard-kicker">ACCOUNT OVERVIEW</p><h1>Welcome back.</h1><p>Here’s what’s happening with your account today.</p></div><Link className="overview-new-order" href="/new-order">⊕ <span>New order</span></Link></header><div className="overview-metrics"><article className="overview-balance"><span>WALLET BALANCE</span><strong>{balance} <small>{wallet?.currency ?? "GHS"}</small></strong><p>Available to spend</p><div className="overview-wave" /></article>{[["TOTAL ORDERS",totalOrders ?? 0,"All time orders"],["COMPLETED",completedOrders ?? 0,"Orders delivered"],["PROCESSING",processingOrders ?? 0,"In progress"],["PENDING / FAILED",pendingOrders ?? 0,"Unsuccessful orders"],["TOTAL SPENT",`${spent} GHS`,"All time total"]].map(([label,value,caption], index) => <article className={`overview-stat overview-stat-${index}`} key={String(label)}><span>{label}</span><strong>{value}</strong><p>{caption}</p></article>)}</div><section className="overview-recent"><div className="overview-recent-heading"><div><h2>Recent orders</h2><p>View your latest VANTA orders.</p></div><Link href="/account/orders">View all <b>→</b></Link></div>{(recentOrders ?? []).length === 0 ? <div className="overview-empty"><div className="empty-icon">V</div><h3>No orders yet</h3><p>You haven’t placed any orders. Get started by creating a new order.</p><Link href="/new-order">Create your first order <b>→</b></Link></div> : <ul className="dashboard-list overview-order-list">{recentOrders?.map((order) => <li key={order.public_order_id}><Link href={`/account/orders/${order.public_order_id}`}>{order.public_order_id}</Link><span>{order.total} {order.currency} · {order.payment_status} / {order.fulfillment_status}</span></li>)}</ul>}</section></div>;
}
