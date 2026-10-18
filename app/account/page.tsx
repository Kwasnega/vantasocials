import Link from "next/link";
import { requireUser } from "../../lib/auth/require-user";
import { formatSpendByCurrency, getAccountOverviewStats } from "../../lib/account/overview";

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

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
  const recentOrders = recentOrdersResult.data ?? [];
  const spent = formatSpendByCurrency(spendByCurrency);
  const balance = (Number(wallet?.balance_minor ?? 0) / 100).toFixed(2);

  return (
    <div className="overview-page">
      <header className="dashboard-header overview-header">
        <div>
          <p className="dashboard-kicker">ACCOUNT OVERVIEW</p>
          <h1>Welcome back.</h1>
          <p>Here’s what’s happening with your account today.</p>
        </div>
        <Link className="overview-new-order" href="/new-order">
          <span aria-hidden="true">⊕</span>
          <span>New order</span>
        </Link>
      </header>

      <div className="overview-metrics">
        <article className="overview-balance">
          <span>WALLET BALANCE</span>
          <strong>{balance} <small>{wallet?.currency ?? "GHS"}</small></strong>
          <p>Available to spend</p>
          <Link className="overview-wallet-link" href="/account/wallet">
            Manage wallet <span aria-hidden="true">→</span>
          </Link>
          <div className="overview-wave" aria-hidden="true" />
        </article>
        <article className="overview-stat overview-stat-total-orders">
          <span>TOTAL ORDERS</span>
          <strong>{totalOrders}</strong>
          <p>All time orders</p>
        </article>
        <article className="overview-stat overview-stat-total-spent">
          <span>TOTAL SPENT</span>
          <strong>{spent}</strong>
          <p>Paid orders only</p>
        </article>
      </div>

      <section className="overview-recent" aria-labelledby="overview-recent-title">
        <div className="overview-recent-heading">
          <div>
            <h2 id="overview-recent-title">Recent orders</h2>
            <p>Your latest VANTA activity, at a glance.</p>
          </div>
          <Link href="/account/orders">View all <b aria-hidden="true">→</b></Link>
        </div>
        {recentOrders.length === 0 ? (
          <div className="overview-empty">
            <div className="empty-icon" aria-hidden="true">V</div>
            <h3>No orders yet</h3>
            <p>You haven’t placed any orders. Get started by creating a new order.</p>
            <Link href="/new-order">Create your first order <b aria-hidden="true">→</b></Link>
          </div>
        ) : (
          <ul className="dashboard-list overview-order-list">
            {recentOrders.map((order) => {
              const paymentStatus = formatStatus(order.payment_status);
              const fulfillmentStatus = formatStatus(order.fulfillment_status);
              return (
                <li key={order.public_order_id}>
                  <div className="overview-order-main">
                    <Link href={`/account/orders/${order.public_order_id}`}>
                      {order.public_order_id}
                      <span aria-hidden="true">↗</span>
                    </Link>
                    <strong>{order.total} {order.currency}</strong>
                  </div>
                  <div className="overview-order-statuses" aria-label="Order statuses">
                    <span className={`order-status ${order.payment_status.toLowerCase()}`} aria-label={`Payment: ${paymentStatus}`}>
                      {paymentStatus}
                    </span>
                    <span className={`order-status ${order.fulfillment_status.toLowerCase().replaceAll("_", "-")}`} aria-label={`Fulfillment: ${fulfillmentStatus}`}>
                      {fulfillmentStatus}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
