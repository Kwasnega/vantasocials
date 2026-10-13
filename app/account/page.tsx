import Link from "next/link";
import { requireUser } from "../../lib/auth/require-user";
import { formatSpendByCurrency, getAccountOverviewStats } from "../../lib/account/overview";

export default async function AccountPage() {
  const { user, db } = await requireUser("/account");
  const [walletResult, overview, recentOrdersResult] = await Promise.all([
    db.from("wallets").select("balance_minor,currency").eq("user_id", user.id).maybeSingle(),
    getAccountOverviewStats(db, user.id),
    db.from("orders").select("public_order_id,total,currency,payment_status,fulfillment_status").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5),
  ]);
  if (walletResult.error) throw walletResult.error;
  if (recentOrdersResult.error) throw recentOrdersResult.error;
  const wallet = walletResult.data;
  const { totalOrders, spendByCurrency } = overview;
  const recentOrders = recentOrdersResult.data;
  const spent = formatSpendByCurrency(spendByCurrency);
  const balance = (Number(wallet?.balance_minor ?? 0) / 100).toFixed(2);
  return <div className="overview-page"><header className="dashboard-header overview-header"><div><p className="dashboard-kicker">ACCOUNT OVERVIEW</p><h1>Welcome back.</h1><p>Here’s what’s happening with your account today.</p></div><Link className="overview-new-order" href="/new-order">⊕ <span>New order</span></Link></header><div className="overview-metrics"><article className="overview-balance"><span>WALLET BALANCE</span><strong>{balance} <small>{wallet?.currency ?? "GHS"}</small></strong><p>Available to spend</p><div className="overview-wave" /></article><article className="overview-stat overview-stat-total-orders"><span>TOTAL ORDERS</span><strong>{totalOrders}</strong><p>All time orders</p></article><article className="overview-stat overview-stat-total-spent"><span>TOTAL SPENT</span><strong>{spent}</strong><p>All time total</p></article></div><section className="overview-recent"><div className="overview-recent-heading"><div><h2>Recent orders</h2><p>View your latest VANTA orders.</p></div><Link href="/account/orders">View all <b>→</b></Link></div>{(recentOrders ?? []).length === 0 ? <div className="overview-empty"><div className="empty-icon">V</div><h3>No orders yet</h3><p>You haven’t placed any orders. Get started by creating a new order.</p><Link href="/new-order">Create your first order <b>→</b></Link></div> : <ul className="dashboard-list overview-order-list">{recentOrders?.map((order) => <li key={order.public_order_id}><Link href={`/account/orders/${order.public_order_id}`}>{order.public_order_id}</Link><span>{order.total} {order.currency} · {order.payment_status} / {order.fulfillment_status}</span></li>)}</ul>}</section></div>;
}
