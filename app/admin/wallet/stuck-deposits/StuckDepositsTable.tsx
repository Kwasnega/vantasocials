"use client";

import { useState } from "react";
import Link from "next/link";

export type StuckDepositRow = {
  id: string;
  userId: string;
  userEmail: string;
  reference: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  lastCheck?: {
    checked_at: string;
    checked_by: string;
    paystack_status: string;
    amount?: number | null;
    paid_at?: string | null;
    gateway_response?: string | null;
  } | null;
  isReconciled: boolean;
  reconciliationNote?: string | null;
};

export function StuckDepositsTable({ initialDeposits }: { initialDeposits: StuckDepositRow[] }) {
  const [deposits, setDeposits] = useState(initialDeposits);
  const [checkingAll, setCheckingAll] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function handleCheckRow(id: string, userId: string) {
    setCheckingId(id);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/admin/customers/${userId}/wallet/deposits/${id}/check`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Check failed");

      setDeposits((prev) =>
        prev.map((d) =>
          d.id === id
            ? {
                ...d,
                lastCheck: {
                  checked_at: data.checked_at,
                  checked_by: "you",
                  paystack_status: data.paystack_status,
                  amount: data.amount_minor,
                  paid_at: data.paid_at,
                  gateway_response: data.gateway_response,
                },
              }
            : d
        )
      );
      setActionMessage(`Checked ${data.reference}: Paystack status is ${data.paystack_status}`);
    } catch (err) {
      setActionMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCheckingId(null);
    }
  }

  async function handleCheckAll() {
    if (deposits.length === 0) return;
    setCheckingAll(true);
    setActionMessage(null);
    try {
      const res = await fetch("/api/admin/wallet/stuck-deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ depositIds: deposits.map((d) => d.id) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Batch check failed");

      // Refetch page data
      const refresh = await fetch("/api/admin/wallet/stuck-deposits");
      const refreshData = await refresh.json();
      if (refreshData.deposits) {
        setDeposits(refreshData.deposits);
      }
      setActionMessage(`Successfully verified ${data.checked_count} deposits against Paystack.`);
    } catch (err) {
      setActionMessage(`Error checking all: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCheckingAll(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ fontSize: "14px", color: "rgba(255,255,255,0.7)" }}>
          Found <strong>{deposits.length}</strong> non-final deposits older than 30 mins
        </div>
        <button
          type="button"
          onClick={handleCheckAll}
          disabled={checkingAll || deposits.length === 0}
          style={{
            padding: "8px 16px",
            backgroundColor: "#6366f1",
            color: "#fff",
            borderRadius: "6px",
            border: "none",
            fontSize: "13px",
            fontWeight: 600,
            cursor: checkingAll ? "not-allowed" : "pointer",
          }}
        >
          {checkingAll ? "Verifying with Paystack (batch)..." : "⚡ Check all with Paystack"}
        </button>
      </div>

      {actionMessage && (
        <div style={{ padding: "10px 14px", backgroundColor: "rgba(99, 102, 241, 0.15)", borderRadius: "6px", border: "1px solid rgba(99, 102, 241, 0.3)", color: "#c7d2fe", fontSize: "13px", marginBottom: "16px" }}>
          {actionMessage}
        </div>
      )}

      <div className="dashboard-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Reference</th>
                <th>Amount</th>
                <th>Our Status</th>
                <th>Paystack Status</th>
                <th>Last Checked</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {deposits.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "30px", color: "rgba(255,255,255,0.5)" }}>
                    No stuck deposits found! All deposits are in a terminal state or recent.
                  </td>
                </tr>
              ) : (
                deposits.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link href={`/admin/customers/${d.userId}`} style={{ color: "#a5b4fc", textDecoration: "none", fontWeight: 600 }}>
                        {d.userEmail}
                      </Link>
                    </td>
                    <td>
                      <code style={{ fontSize: "11px" }}>{d.reference}</code>
                    </td>
                    <td>
                      <strong>{d.currency} {d.amount.toFixed(2)}</strong>
                    </td>
                    <td>
                      <span className={`admin-status ${d.status.toLowerCase()}`}>{d.status}</span>
                      {d.isReconciled && (
                        <div style={{ fontSize: "10px", color: "#34d399", fontWeight: 600, marginTop: "2px" }}>
                          ✓ Reconciled
                        </div>
                      )}
                    </td>
                    <td>
                      {d.lastCheck ? (
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            padding: "2px 6px",
                            borderRadius: "4px",
                            backgroundColor:
                              d.lastCheck.paystack_status === "SUCCESS"
                                ? "rgba(16, 185, 129, 0.2)"
                                : d.lastCheck.paystack_status === "ABANDONED"
                                ? "rgba(245, 158, 11, 0.2)"
                                : "rgba(239, 68, 68, 0.2)",
                            color:
                              d.lastCheck.paystack_status === "SUCCESS"
                                ? "#34d399"
                                : d.lastCheck.paystack_status === "ABANDONED"
                                ? "#fbbf24"
                                : "#f87171",
                          }}
                        >
                          {d.lastCheck.paystack_status}
                        </span>
                      ) : (
                        <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "12px" }}>Not checked</span>
                      )}
                    </td>
                    <td style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>
                      {d.lastCheck?.checked_at ? new Date(d.lastCheck.checked_at).toLocaleTimeString() : "—"}
                    </td>
                    <td style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>
                      {new Date(d.createdAt).toLocaleDateString()}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          type="button"
                          onClick={() => handleCheckRow(d.id, d.userId)}
                          disabled={checkingId === d.id}
                          style={{
                            padding: "4px 8px",
                            borderRadius: "4px",
                            backgroundColor: "rgba(255,255,255,0.1)",
                            border: "none",
                            color: "#fff",
                            fontSize: "11px",
                            cursor: checkingId === d.id ? "not-allowed" : "pointer",
                          }}
                        >
                          {checkingId === d.id ? "Checking..." : "Check"}
                        </button>
                        <Link
                          href={`/admin/customers/${d.userId}`}
                          style={{
                            padding: "4px 8px",
                            borderRadius: "4px",
                            backgroundColor: "rgba(99, 102, 241, 0.2)",
                            color: "#a5b4fc",
                            textDecoration: "none",
                            fontSize: "11px",
                            fontWeight: 600,
                          }}
                        >
                          View & Resolve
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
