import Link from "next/link";
import { requireAdmin } from "../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../lib/supabase/server";
import { AdminQueryError } from "./AdminDataState";

export default async function AdminPage() {
  const { admin } = await requireAdmin();
  if (!admin) return null;
  const db = createSupabaseAdminClient();
  const [
    { count: customers, error: customersError },
    { count: orders, error: ordersError },
    { data: wallets, count: walletCount, error: walletsError },
    { data: recent, error: recentError },
    { data: providerHealth, error: providerHealthError },
    { count: catalogCount, error: catalogError }
  ] = await Promise.all([
    db.from("profiles").select("id", { count: "exact", head: true }),
    db.from("orders").select("id", { count: "exact", head: true }),
    db.from("wallets").select("balance_minor,currency", { count: "exact" }).order("created_at", { ascending: true }).limit(1000),
    db.from("orders").select("public_order_id,total,currency,payment_status,fulfillment_status,created_at,profiles(email),services(name)").order("created_at", { ascending: false }).limit(10),
    db.from("provider_health").select("configured,balance,balance_currency,last_balance_check,balance_status").eq("provider", "reliablesmm").maybeSingle(),
    db.from("provider_catalog_services").select("id", { count: "exact", head: true }).eq("provider", "reliablesmm")
  ]);
  const ghsBalanceSample = (wallets ?? []).filter((wallet) => wallet.currency === "GHS").reduce((sum, wallet) => sum + Number(wallet.balance_minor ?? 0), 0);
  const walletSampleComplete = walletCount !== null && walletCount <= (wallets?.length ?? 0);

  return (
    <div className="admin-overview">
      <header className="admin-overview-header">
        <div>
          <p className="dashboard-kicker">OPERATIONS</p>
          <h1>WELCOME BACK PLAY.ATO</h1>
          <p>Monitor VANTA operations and manage activity in real time.</p>
        </div>
        <span className="admin-live-badge">{[customersError, ordersError, walletsError, recentError, providerHealthError, catalogError].some(Boolean) ? "● Some data unavailable" : "● Live data"}</span>
        <div className="admin-overview-mark" aria-hidden="true">V</div>
      </header>
      <div className="admin-summary-layout">
        <div className="admin-side-stats">
          <article className="admin-kpi-card">
            <span>Total orders</span>
            {ordersError ? <AdminQueryError message="Order count unavailable." /> : <strong>{orders ?? "Unavailable"}</strong>}
            <small>All time orders</small>
          </article>
          <article className="admin-kpi-card">
            <span>Customers</span>
            {customersError ? <AdminQueryError message="Customer count unavailable." /> : <strong>{customers ?? "Unavailable"}</strong>}
            <small>Registered users</small>
          </article>
        </div>
        <article className="admin-wallet-focus">
          <span>GHS wallet balance sample</span>
          {walletsError ? <AdminQueryError message="Wallet balance sample unavailable." /> : (
            <>
              <strong>{(ghsBalanceSample / 100).toFixed(2)} <em>GHS</em></strong>
              <small>{walletSampleComplete ? `GHS balances among all ${walletCount ?? 0} wallets` : `GHS balances among up to 1,000 of ${walletCount ?? "unknown"} wallets; not total liability`}</small>
            </>
          )}
          <div className="admin-wallet-orbit" aria-hidden="true" />
        </article>
      </div>
      <div className="admin-overview-columns">
        <section className="admin-recent-panel">
          <div className="admin-panel-heading">
            <div>
              <h2>Recent orders</h2>
              <p>Latest customer activity across VANTA.</p>
            </div>
            <Link href="/admin/orders">View all →</Link>
          </div>
          {recentError ? <AdminQueryError message="Recent orders could not be loaded." /> : (recent ?? []).length === 0 ? (
            <div className="admin-empty">
              <div className="empty-icon">V</div>
              <h3>No orders yet</h3>
              <p>New customer orders will appear here.</p>
            </div>
          ) : (
            <div className="dashboard-table-wrap">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(recent ?? []).map((order) => (
                    <tr key={order.public_order_id}>
                      <td>
                        <Link href={`/admin/orders/${order.public_order_id}`}>{order.public_order_id}</Link>
                      </td>
                      <td>{(order.profiles as { email?: string } | null)?.email ?? "—"}</td>
                      <td>{order.total} {order.currency}</td>
                      <td>
                        <span className={`admin-status ${order.fulfillment_status.toLowerCase()}`}>
                          {order.fulfillment_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="admin-provider-panel">
          <div className="admin-panel-heading">
            <div>
              <h2>Provider health</h2>
              <p>ReliableSMM account status.</p>
            </div>
            {providerHealthError ? <AdminQueryError message="Provider health is unavailable." /> : (
              <span className={`provider-health-status ${providerHealth?.balance_status === "SUCCEEDED" ? "is-good" : ""}`}>
                {providerHealth ? providerHealth.configured ? "Configured" : "Not configured" : "No health record"}
              </span>
            )}
          </div>
          {providerHealthError ? null : (
            <>
              <div className="provider-health-grid">
                <div>
                  <span>Catalog</span>
                  {catalogError ? <AdminQueryError message="Catalog count unavailable." /> : <strong>{catalogCount ?? "Unavailable"}</strong>}
                </div>
                <div>
                  <span>Balance</span>
                  <strong>{providerHealth?.balance ?? "—"} {providerHealth?.balance_currency ?? ""}</strong>
                </div>
                <div>
                  <span>Status</span>
                  <strong>{providerHealth?.balance_status ?? "—"}</strong>
                </div>
                <div>
                  <span>Last check</span>
                  <strong>{providerHealth?.last_balance_check ? new Date(providerHealth.last_balance_check).toLocaleDateString() : "—"}</strong>
                </div>
              </div>
              <small>Read-only provider monitoring. Write operations remain disabled.</small>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
