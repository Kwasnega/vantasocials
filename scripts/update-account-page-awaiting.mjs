import fs from "fs";

let content = fs.readFileSync("app/account/page.tsx", "utf8");
const isCrlf = content.includes("\r\n");
const normalized = content.replace(/\r\n/g, "\n");

const target = `      <div className="overview-metrics">
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
      </div>`;

const replacement = `      <div className="overview-metrics">
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
          <p>Paid orders</p>
        </article>
        <article className="overview-stat overview-stat-total-spent">
          <span>TOTAL SPENT</span>
          <strong>{spent}</strong>
          <p>Paid orders only</p>
        </article>
      </div>

      {awaitingPaymentOrders.length > 0 && (
        <section className="overview-recent" style={{ marginBottom: "24px" }} aria-labelledby="overview-awaiting-title">
          <div className="overview-recent-heading">
            <div>
              <h2 id="overview-awaiting-title" style={{ color: "#fbbf24" }}>Awaiting Payment ({awaitingPaymentOrders.length})</h2>
              <p>These orders require payment to begin processing.</p>
            </div>
            <Link href="/account/orders?status=UNPAID">View awaiting payment <b aria-hidden="true">→</b></Link>
          </div>
          <ul className="dashboard-list overview-order-list">
            {awaitingPaymentOrders.map((order) => (
              <li key={order.public_order_id}>
                <div className="overview-order-main">
                  <Link href={\`/account/orders/\${order.public_order_id}\`}>
                    {order.public_order_id}
                    <span aria-hidden="true">↗</span>
                  </Link>
                  <strong>{order.total} {order.currency}</strong>
                </div>
                <div className="overview-order-statuses" aria-label="Order statuses">
                  <span className="order-status unpaid" style={{ backgroundColor: "rgba(239, 68, 68, 0.2)", color: "#f87171" }}>
                    Awaiting Payment
                  </span>
                  <Link
                    href={\`/checkout?order=\${order.public_order_id}\`}
                    style={{
                      padding: "4px 8px",
                      borderRadius: "4px",
                      backgroundColor: "#f59e0b",
                      color: "#000",
                      fontSize: "11px",
                      fontWeight: 700,
                      textDecoration: "none",
                    }}
                  >
                    Pay Now →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}`;

if (normalized.includes(target)) {
  const updated = normalized.replace(target, replacement);
  fs.writeFileSync("app/account/page.tsx", isCrlf ? updated.replace(/\n/g, "\r\n") : updated);
  console.log("REPLACED AWAITING PAYMENT SECTION SUCCESSFULLY!");
} else {
  console.error("METRICS TARGET NOT FOUND");
}
