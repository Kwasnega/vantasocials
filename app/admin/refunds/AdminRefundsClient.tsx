"use client";

import { useState } from "react";

export type RefundReportRow = {
  id: string;
  publicOrderId: string;
  customerEmail: string;
  serviceName: string;
  amount: number;
  currency: string;
  refundedAt: string;
  refundedBy: string;
  mode: "AUTOMATIC" | "MANUAL";
  failureReason: string;
};

export type AdminRefundsClientProps = {
  initialDays: number;
  initialCount: number;
  initialTotal: number;
  initialRows: RefundReportRow[];
};

export function AdminRefundsClient({
  initialDays,
  initialCount,
  initialTotal,
  initialRows,
}: AdminRefundsClientProps) {
  const [days, setDays] = useState(initialDays);
  const [rows, setRows] = useState<RefundReportRow[]>(initialRows);
  const [count, setCount] = useState(initialCount);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);

  async function handleDaysChange(newDays: number) {
    setDays(newDays);
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/reports/refunds?days=${newDays}`);
      const data = await res.json();
      if (res.ok) {
        setRows(data.rows || []);
        setCount(data.count || 0);
        setTotal(data.totalRefundAmount || 0);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="admin-orders-page orders-redesign">
      <header className="orders-hero" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <p className="dashboard-kicker">FINANCIAL RECONCILIATION</p>
          <h1>Customer Refunds</h1>
          <p style={{ color: "rgba(255,255,255,0.7)", margin: "4px 0 0" }}>
            Audit log of all order refunds credited to customer wallets.
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <select
            value={days}
            onChange={(e) => handleDaysChange(Number(e.target.value))}
            style={{
              padding: "8px 12px",
              borderRadius: "6px",
              backgroundColor: "#1a1d28",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "#fff",
              fontSize: "13px",
            }}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>

          <a
            href={`/api/admin/reports/refunds?days=${days}&format=csv`}
            download
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 14px",
              borderRadius: "6px",
              backgroundColor: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "#fff",
              textDecoration: "none",
              fontSize: "13px",
              fontWeight: 500,
            }}
          >
            <span>↓</span> Export CSV
          </a>
        </div>
      </header>

      {/* Metric Cards */}
      <section className="dashboard-grid" style={{ marginBottom: "24px" }}>
        <article className="dashboard-card">
          <span>Total Refunds</span>
          <strong>{count}</strong>
          <small>In the last {days} days</small>
        </article>
        <article className="dashboard-card">
          <span>Total Amount Credited</span>
          <strong style={{ color: "#c084fc" }}>GHS {total.toFixed(2)}</strong>
          <small>Direct wallet ledger credits</small>
        </article>
        <article className="dashboard-card">
          <span>Average Refund</span>
          <strong>GHS {count > 0 ? (total / count).toFixed(2) : "0.00"}</strong>
          <small>Per refunded order</small>
        </article>
      </section>

      {/* Refunds Table */}
      <section className="dashboard-card">
        <h2>Refund Transactions ({count})</h2>
        {loading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "rgba(255,255,255,0.5)" }}>
            Loading refund records...
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center", color: "rgba(255,255,255,0.5)" }}>
            No refund records in this period.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Customer</th>
                  <th>Service</th>
                  <th>Amount</th>
                  <th>Mode</th>
                  <th>Triggered By</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a href={`/admin/orders/${r.publicOrderId}`} style={{ color: "#a5b4fc", fontWeight: 600 }}>
                        {r.publicOrderId}
                      </a>
                    </td>
                    <td>{r.customerEmail}</td>
                    <td>{r.serviceName}</td>
                    <td style={{ color: "#c084fc", fontWeight: 600 }}>
                      GHS {r.amount.toFixed(2)}
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 600,
                          padding: "2px 6px",
                          borderRadius: "4px",
                          backgroundColor: r.mode === "AUTOMATIC" ? "rgba(59, 130, 246, 0.2)" : "rgba(168, 85, 247, 0.2)",
                          color: r.mode === "AUTOMATIC" ? "#93c5fd" : "#d8b4fe",
                        }}
                      >
                        {r.mode}
                      </span>
                    </td>
                    <td style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)" }}>{r.refundedBy}</td>
                    <td style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)" }}>
                      {new Date(r.refundedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
