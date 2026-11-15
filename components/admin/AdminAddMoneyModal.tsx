"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type AdminAddMoneyModalProps = {
  isOpen: boolean;
  onClose: () => void;
  customerId: string;
  customerEmail: string;
  customerOrders?: Array<{
    id: string;
    publicOrderId: string;
    total: number;
    fulfillmentStatus: string;
    refundStatus?: string | null;
  }>;
};

const REASON_CATEGORIES = [
  { value: "service_not_delivered", label: "Service not delivered" },
  { value: "refund", label: "Refund compensation" },
  { value: "goodwill", label: "Customer goodwill" },
  { value: "correction", label: "Balance correction" },
  { value: "other", label: "Other" },
];

export function AdminAddMoneyModal({
  isOpen,
  onClose,
  customerId,
  customerEmail,
  customerOrders = [],
}: AdminAddMoneyModalProps) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("service_not_delivered");
  const [note, setNote] = useState("");
  const [linkedOrderId, setLinkedOrderId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Generate idempotency key once per dialog session
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  if (!isOpen) return null;

  const selectedOrder = customerOrders.find((o) => o.id === linkedOrderId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError("Please enter a valid positive amount in GHS.");
      return;
    }

    if (!note.trim()) {
      setError("A short note explaining the credit is required.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/customers/${customerId}/wallet/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: parsedAmount,
          category,
          note: note.trim(),
          order_id: linkedOrderId || undefined,
          idempotency_key: idempotencyKey,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to add money");
      }

      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Adjustment failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "16px",
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        style={{
          backgroundColor: "#12141c",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: "12px",
          maxWidth: "480px",
          width: "100%",
          padding: "24px",
          color: "#fff",
        }}
      >
        <h2 style={{ margin: "0 0 12px", fontSize: "18px" }}>Add Money to Customer Wallet</h2>
        <p style={{ color: "rgba(255,255,255,0.7)", fontSize: "13px", margin: "0 0 16px" }}>
          Credit funds directly to <strong>{customerEmail}</strong>. Protected against double-crediting.
        </p>

        <form onSubmit={handleSubmit}>
          {/* Amount */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "6px" }}>
              Amount in GHS (Max cap GHS 500.00):
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max="500.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 25.00"
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "6px",
                backgroundColor: "#1a1d28",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                color: "#fff",
                fontSize: "14px",
              }}
              required
            />
          </div>

          {/* Reason Category */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "6px" }}>
              Reason Category:
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "6px",
                backgroundColor: "#1a1d28",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                color: "#fff",
                fontSize: "13px",
              }}
            >
              {REASON_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* Optional Linked Order */}
          {customerOrders.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "6px" }}>
                Optional Linked Order:
              </label>
              <select
                value={linkedOrderId}
                onChange={(e) => setLinkedOrderId(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: "6px",
                  backgroundColor: "#1a1d28",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  color: "#fff",
                  fontSize: "13px",
                }}
              >
                <option value="">None (General credit)</option>
                {customerOrders.map((o) => (
                  <option key={o.id} value={o.id}>
                    #{o.publicOrderId} — GHS {o.total.toFixed(2)} ({o.fulfillmentStatus})
                  </option>
                ))}
              </select>

              {selectedOrder && (
                <div style={{ marginTop: "6px", fontSize: "12px", color: selectedOrder.refundStatus === "REFUNDED" ? "#f59e0b" : "rgba(255,255,255,0.6)" }}>
                  {selectedOrder.refundStatus === "REFUNDED" ? (
                    <span>⚠️ Warning: This order was already marked REFUNDED.</span>
                  ) : (
                    <span>Linked order total: GHS {selectedOrder.total.toFixed(2)} ({selectedOrder.fulfillmentStatus})</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Internal Note */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "6px" }}>
              Internal Admin Note (Required):
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Compensating for delayed TikTok views delivery per ticket #402..."
              rows={3}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "6px",
                backgroundColor: "#1a1d28",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                color: "#fff",
                fontSize: "13px",
                resize: "vertical",
              }}
              required
            />
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", marginTop: "4px" }}>
              Note is recorded in audit logs. Customer will see a neutral description: "Account credit from VANTA support".
            </div>
          </div>

          {error && (
            <div style={{ padding: "10px", borderRadius: "6px", backgroundColor: "rgba(229, 62, 62, 0.15)", color: "#fc8181", fontSize: "13px", marginBottom: "16px" }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              style={{
                padding: "10px 16px",
                borderRadius: "6px",
                background: "transparent",
                border: "1px solid rgba(255, 255, 255, 0.2)",
                color: "#fff",
                fontSize: "13px",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: "10px 18px",
                borderRadius: "6px",
                backgroundColor: "#10b981",
                border: "none",
                color: "#fff",
                fontWeight: 600,
                fontSize: "13px",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Crediting..." : `Add Money (${amount ? `GHS ${parseFloat(amount || "0").toFixed(2)}` : ""})`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
