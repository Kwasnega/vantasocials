"use client";

import { useState } from "react";
import { CustomerStatusModal } from "./CustomerStatusModal";
import { AdminAddMoneyModal } from "./AdminAddMoneyModal";
import { AdminEditBalanceModal } from "./AdminEditBalanceModal";

export type CustomerDetailTabsProps = {
  customerId: string;
  customerEmail: string;
  currentStatus: "ACTIVE" | "FLAGGED" | "SUSPENDED";
  statusReason?: string | null;
  orders: Array<{
    id: string;
    publicOrderId: string;
    serviceName: string;
    platformName: string;
    targetValue: string;
    quantity: number;
    total: number;
    currency: string;
    status: string;
    paymentStatus: string;
    fulfillmentStatus: string;
    failureReason?: string | null;
    refundStatus?: string | null;
    createdAt: string;
  }>;
  deposits: Array<{
    id: string;
    reference: string;
    amount: number;
    currency: string;
    status: string;
    paidAt?: string | null;
    createdAt: string;
  }>;
  ledger: Array<{
    id: string;
    type: string;
    direction: string;
    amount: number;
    currency: string;
    reference: string;
    createdAt: string;
  }>;
  notes: Array<{
    id: string;
    category: string;
    status: string;
    body: string;
    authorEmail?: string;
    orderId?: string | null;
    linkedOrderPublicId?: string | null;
    linkedOrderSummary?: {
      paid: boolean;
      fulfillmentStatus: string;
      failureReason?: string | null;
      refundStatus?: string | null;
      total: number;
    } | null;
    createdAt: string;
  }>;
  activity: Array<{
    id: string;
    type: string;
    title: string;
    description: string;
    timestamp: string;
  }>;
  ledgerSumGhs: number;
  currentWalletBalanceGhs: number;
  balanceMatches: boolean;
};

export function CustomerDetailTabs({
  customerId,
  customerEmail,
  currentStatus,
  statusReason,
  orders,
  deposits,
  ledger,
  notes,
  activity,
  ledgerSumGhs,
  currentWalletBalanceGhs,
  balanceMatches,
}: CustomerDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<"orders" | "deposits" | "ledger" | "notes" | "activity">("orders");
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [addMoneyModalOpen, setAddMoneyModalOpen] = useState(false);
  const [editBalanceModalOpen, setEditBalanceModalOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  // New Note state
  const [noteBody, setNoteBody] = useState("");
  const [noteCategory, setNoteCategory] = useState<"complaint" | "refund_request" | "verification" | "other">("complaint");
  const [noteOrderId, setNoteOrderId] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  function copyUserId() {
    navigator.clipboard.writeText(customerId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  }

  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteBody.trim()) return;
    setSubmittingNote(true);
    setNoteError(null);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: noteBody.trim(),
          category: noteCategory,
          order_id: noteOrderId.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add note");
      setNoteBody("");
      setNoteOrderId("");
      window.location.reload();
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : "Error creating note");
    } finally {
      setSubmittingNote(false);
    }
  }

  async function handleToggleNoteStatus(noteId: string, nextStatus: "open" | "resolved") {
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        window.location.reload();
      }
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div>
      {/* Customer Header */}
      <header className="dashboard-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px", marginBottom: "24px" }}>
        <div>
          <p className="dashboard-kicker">CUSTOMER PROFILE & AUDIT</p>
          <h1 style={{ display: "flex", alignItems: "center", gap: "12px", margin: "4px 0" }}>
            {customerEmail}
            <span
              style={{
                fontSize: "12px",
                padding: "3px 8px",
                borderRadius: "6px",
                fontWeight: 600,
                backgroundColor:
                  currentStatus === "SUSPENDED"
                    ? "rgba(239, 68, 68, 0.2)"
                    : currentStatus === "FLAGGED"
                    ? "rgba(245, 158, 11, 0.2)"
                    : "rgba(16, 185, 129, 0.2)",
                color:
                  currentStatus === "SUSPENDED"
                    ? "#ef4444"
                    : currentStatus === "FLAGGED"
                    ? "#f59e0b"
                    : "#10b981",
                border: `1px solid ${
                  currentStatus === "SUSPENDED"
                    ? "rgba(239, 68, 68, 0.4)"
                    : currentStatus === "FLAGGED"
                    ? "rgba(245, 158, 11, 0.4)"
                    : "rgba(16, 185, 129, 0.4)"
                }`,
              }}
            >
              {currentStatus}
            </span>
          </h1>

          {statusReason && (
            <p style={{ color: "#fca5a5", fontSize: "12px", margin: "4px 0" }}>
              Reason: {statusReason}
            </p>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "8px" }}>
            <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)" }}>User ID: {customerId}</span>
            <button
              type="button"
              onClick={copyUserId}
              style={{
                background: "rgba(255,255,255,0.1)",
                border: "none",
                borderRadius: "4px",
                color: "#fff",
                fontSize: "11px",
                padding: "2px 8px",
                cursor: "pointer",
              }}
            >
              {copiedId ? "✓ Copied" : "Copy ID"}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button
            type="button"
            onClick={() => setAddMoneyModalOpen(true)}
            style={{
              padding: "8px 14px",
              borderRadius: "6px",
              backgroundColor: "rgba(16, 185, 129, 0.2)",
              border: "1px solid rgba(16, 185, 129, 0.4)",
              color: "#34d399",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            + Add money
          </button>
          <button
            type="button"
            onClick={() => setEditBalanceModalOpen(true)}
            style={{
              padding: "8px 14px",
              borderRadius: "6px",
              backgroundColor: "rgba(216, 131, 255, 0.18)",
              border: "1px solid rgba(216, 131, 255, 0.35)",
              color: "#d883ff",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            ✎ Edit Balance
          </button>
          <button
            type="button"
            onClick={() => setStatusModalOpen(true)}
            style={{
              padding: "8px 14px",
              borderRadius: "6px",
              backgroundColor: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "#fff",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            ⚙ Change Account Status
          </button>
        </div>
      </header>

      {/* Ledger Integrity Alert */}
      {!balanceMatches && (
        <div
          style={{
            padding: "14px",
            borderRadius: "8px",
            backgroundColor: "rgba(239, 68, 68, 0.15)",
            border: "1px solid rgba(239, 68, 68, 0.4)",
            color: "#fca5a5",
            marginBottom: "24px",
            fontSize: "13px",
          }}
        >
          <strong>⚠️ Wallet Ledger Balance Mismatch Detected:</strong>
          <div style={{ marginTop: "4px" }}>
            The wallet projected balance is <strong>GHS {currentWalletBalanceGhs.toFixed(2)}</strong>, but the sum of immutable ledger transactions is <strong>GHS {ledgerSumGhs.toFixed(2)}</strong>. Please investigate the transactions tab.
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.1)", gap: "8px", marginBottom: "20px" }}>
        {[
          { key: "orders", label: `Orders (${orders.length})` },
          { key: "deposits", label: `Deposits (${deposits.length})` },
          { key: "ledger", label: `Wallet Ledger (${ledger.length})` },
          { key: "notes", label: `Notes & Complaints (${notes.length})` },
          { key: "activity", label: `Activity (${activity.length})` },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key as typeof activeTab)}
            style={{
              padding: "10px 16px",
              background: "none",
              border: "none",
              borderBottom: activeTab === t.key ? "2px solid #6366f1" : "2px solid transparent",
              color: activeTab === t.key ? "#fff" : "rgba(255,255,255,0.6)",
              fontWeight: activeTab === t.key ? 600 : 400,
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content: Orders */}
      {activeTab === "orders" && (
        <section className="dashboard-card">
          <h2>Customer Orders</h2>
          {orders.length === 0 ? (
            <div style={{ padding: "30px", textAlign: "center", color: "rgba(255,255,255,0.5)" }}>
              No orders found for this customer.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Service</th>
                    <th>Target</th>
                    <th>Qty</th>
                    <th>Total</th>
                    <th>Fulfillment</th>
                    <th>Refund</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <a href={`/admin/orders/${o.publicOrderId}`} style={{ color: "#a5b4fc", fontWeight: 600 }}>
                          {o.publicOrderId}
                        </a>
                      </td>
                      <td>
                        <div style={{ fontSize: "13px" }}>{o.serviceName}</div>
                        <small style={{ color: "rgba(255,255,255,0.5)" }}>{o.platformName}</small>
                      </td>
                      <td style={{ maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "12px" }}>
                        {o.targetValue}
                      </td>
                      <td>{o.quantity.toLocaleString()}</td>
                      <td>{o.currency} {o.total.toFixed(2)}</td>
                      <td>
                        <span className={`admin-status ${o.fulfillmentStatus.toLowerCase()}`}>{o.fulfillmentStatus}</span>
                        {o.failureReason && (
                          <div style={{ fontSize: "11px", color: "#f87171", marginTop: "2px" }}>{o.failureReason}</div>
                        )}
                      </td>
                      <td>
                        {o.refundStatus === "REFUNDED" ? (
                          <span style={{ fontSize: "11px", color: "#c084fc", fontWeight: 600 }}>✓ Refunded</span>
                        ) : (
                          <span style={{ color: "rgba(255,255,255,0.4)" }}>—</span>
                        )}
                      </td>
                      <td style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)" }}>
                        {new Date(o.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Tab Content: Deposits */}
      {activeTab === "deposits" && (
        <section className="dashboard-card">
          <h2>Paystack Wallet Deposits</h2>
          {deposits.length === 0 ? (
            <div style={{ padding: "30px", textAlign: "center", color: "rgba(255,255,255,0.5)" }}>
              No deposit records found for this customer.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Paid Date</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {deposits.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <code style={{ fontSize: "12px" }}>{d.reference}</code>
                      </td>
                      <td style={{ fontWeight: 600, color: d.status === "COMPLETED" ? "#48bb78" : "#fff" }}>
                        {d.currency} {d.amount.toFixed(2)}
                      </td>
                      <td>
                        <span className={`admin-status ${d.status.toLowerCase()}`}>{d.status}</span>
                      </td>
                      <td style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)" }}>
                        {d.paidAt ? new Date(d.paidAt).toLocaleString() : "—"}
                      </td>
                      <td style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)" }}>
                        {new Date(d.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Tab Content: Ledger */}
      {activeTab === "ledger" && (
        <section className="dashboard-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2 style={{ margin: 0 }}>Immutable Wallet Ledger</h2>
            <div style={{ fontSize: "13px" }}>
              Sum: <strong style={{ color: "#48bb78" }}>GHS {ledgerSumGhs.toFixed(2)}</strong> | Current Wallet: <strong>GHS {currentWalletBalanceGhs.toFixed(2)}</strong>
            </div>
          </div>
          {ledger.length === 0 ? (
            <div style={{ padding: "30px", textAlign: "center", color: "rgba(255,255,255,0.5)" }}>
              No ledger entries found.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Direction</th>
                    <th>Amount</th>
                    <th>Reference</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((tx) => (
                    <tr key={tx.id}>
                      <td>
                        <span style={{ fontWeight: 600, fontSize: "12px" }}>{tx.type}</span>
                      </td>
                      <td>
                        <span style={{ color: tx.direction === "CREDIT" ? "#48bb78" : "#f87171", fontWeight: 700 }}>
                          {tx.direction === "CREDIT" ? "+" : "-"} {tx.direction}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {tx.currency} {tx.amount.toFixed(2)}
                      </td>
                      <td style={{ fontSize: "12px", color: "rgba(255,255,255,0.7)" }}>
                        {tx.reference}
                      </td>
                      <td style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)" }}>
                        {new Date(tx.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Tab Content: Notes & Complaints */}
      {activeTab === "notes" && (
        <div>
          {/* Add Note Form */}
          <section className="dashboard-card" style={{ marginBottom: "20px" }}>
            <h2 style={{ fontSize: "16px", marginBottom: "12px" }}>Add Customer Note or Complaint</h2>
            <form onSubmit={handleAddNote}>
              <div style={{ display: "flex", gap: "12px", marginBottom: "12px", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: "180px" }}>
                  <label style={{ display: "block", fontSize: "12px", marginBottom: "4px", color: "rgba(255,255,255,0.6)" }}>
                    Category
                  </label>
                  <select
                    value={noteCategory}
                    onChange={(e) => setNoteCategory(e.target.value as typeof noteCategory)}
                    style={{
                      width: "100%",
                      padding: "8px",
                      borderRadius: "6px",
                      backgroundColor: "#1a1d28",
                      border: "1px solid rgba(255, 255, 255, 0.15)",
                      color: "#fff",
                      fontSize: "13px",
                    }}
                  >
                    <option value="complaint">Complaint</option>
                    <option value="refund_request">Refund Request</option>
                    <option value="verification">Verification</option>
                    <option value="other">Other Note</option>
                  </select>
                </div>

                <div style={{ flex: 1, minWidth: "180px" }}>
                  <label style={{ display: "block", fontSize: "12px", marginBottom: "4px", color: "rgba(255,255,255,0.6)" }}>
                    Optional Linked Order ID (UUID)
                  </label>
                  <input
                    type="text"
                    value={noteOrderId}
                    onChange={(e) => setNoteOrderId(e.target.value)}
                    placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                    style={{
                      width: "100%",
                      padding: "8px",
                      borderRadius: "6px",
                      backgroundColor: "#1a1d28",
                      border: "1px solid rgba(255, 255, 255, 0.15)",
                      color: "#fff",
                      fontSize: "13px",
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: "12px" }}>
                <textarea
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  placeholder="Record note or complaint details here..."
                  rows={3}
                  style={{
                    width: "100%",
                    padding: "10px",
                    borderRadius: "6px",
                    backgroundColor: "#1a1d28",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    color: "#fff",
                    fontSize: "13px",
                  }}
                  required
                />
              </div>

              {noteError && (
                <div style={{ color: "#fc8181", fontSize: "12px", marginBottom: "12px" }}>{noteError}</div>
              )}

              <button
                type="submit"
                disabled={submittingNote}
                style={{
                  padding: "8px 16px",
                  borderRadius: "6px",
                  backgroundColor: "#6366f1",
                  border: "none",
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: "13px",
                  cursor: submittingNote ? "not-allowed" : "pointer",
                }}
              >
                {submittingNote ? "Saving..." : "Save Note"}
              </button>
            </form>
          </section>

          {/* Notes List */}
          <section className="dashboard-card">
            <h2>Customer Notes & Audit Trail ({notes.length})</h2>
            {notes.length === 0 ? (
              <div style={{ padding: "30px", textAlign: "center", color: "rgba(255,255,255,0.5)" }}>
                No notes or complaints logged for this customer.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {notes.map((n) => (
                  <div
                    key={n.id}
                    style={{
                      padding: "14px",
                      borderRadius: "8px",
                      backgroundColor: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            padding: "2px 8px",
                            borderRadius: "4px",
                            backgroundColor: n.category === "complaint" ? "rgba(239, 68, 68, 0.2)" : "rgba(99, 102, 241, 0.2)",
                            color: n.category === "complaint" ? "#f87171" : "#a5b4fc",
                          }}
                        >
                          {n.category.replace("_", " ").toUpperCase()}
                        </span>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            padding: "2px 8px",
                            borderRadius: "4px",
                            backgroundColor: n.status === "open" ? "rgba(245, 158, 11, 0.2)" : "rgba(16, 185, 129, 0.2)",
                            color: n.status === "open" ? "#fbbf24" : "#34d399",
                          }}
                        >
                          {n.status.toUpperCase()}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleToggleNoteStatus(n.id, n.status === "open" ? "resolved" : "open")}
                        style={{
                          background: "none",
                          border: "1px solid rgba(255,255,255,0.2)",
                          borderRadius: "4px",
                          color: "#fff",
                          fontSize: "11px",
                          padding: "2px 8px",
                          cursor: "pointer",
                        }}
                      >
                        {n.status === "open" ? "Mark Resolved" : "Re-open"}
                      </button>
                    </div>

                    <p style={{ margin: "8px 0", fontSize: "14px", color: "#fff", lineHeight: 1.5 }}>{n.body}</p>

                    {/* Complaint Verification Helper Panel */}
                    {n.linkedOrderSummary && (
                      <div
                        style={{
                          marginTop: "8px",
                          padding: "10px",
                          borderRadius: "6px",
                          backgroundColor: "rgba(255,255,255,0.05)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          fontSize: "12px",
                        }}
                      >
                        <strong>Order Check ({n.linkedOrderPublicId}):</strong> Paid:{" "}
                        {n.linkedOrderSummary.paid ? "✓ YES" : "✗ NO"} · Status:{" "}
                        {n.linkedOrderSummary.fulfillmentStatus}
                        {n.linkedOrderSummary.failureReason && ` (${n.linkedOrderSummary.failureReason})`} · Refund:{" "}
                        {n.linkedOrderSummary.refundStatus || "NONE"}
                      </div>
                    )}

                    <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", marginTop: "8px" }}>
                      Logged {new Date(n.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Tab Content: Activity Feed */}
      {activeTab === "activity" && (
        <section className="dashboard-card">
          <h2>Unified Activity Timeline</h2>
          {activity.length === 0 ? (
            <div style={{ padding: "30px", textAlign: "center", color: "rgba(255,255,255,0.5)" }}>
              No recorded activity.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {activity.map((a) => (
                <div
                  key={a.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "12px",
                    padding: "8px 0",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                  }}
                >
                  <div style={{ minWidth: "140px", fontSize: "12px", color: "rgba(255,255,255,0.4)" }}>
                    {new Date(a.timestamp).toLocaleString()}
                  </div>
                  <div>
                    <strong style={{ fontSize: "13px", color: "#fff", display: "block" }}>{a.title}</strong>
                    <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.7)" }}>{a.description}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <CustomerStatusModal
        isOpen={statusModalOpen}
        onClose={() => setStatusModalOpen(false)}
        customerId={customerId}
        currentStatus={currentStatus}
        customerEmail={customerEmail}
      />

      <AdminAddMoneyModal
        isOpen={addMoneyModalOpen}
        onClose={() => setAddMoneyModalOpen(false)}
        customerId={customerId}
        customerEmail={customerEmail}
        customerOrders={orders}
      />

      <AdminEditBalanceModal
        isOpen={editBalanceModalOpen}
        onClose={() => setEditBalanceModalOpen(false)}
        customerId={customerId}
        customerEmail={customerEmail}
        currentBalanceGhs={currentWalletBalanceGhs}
      />
    </div>
  );
}
