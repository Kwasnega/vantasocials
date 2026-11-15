"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type AdminRefundModalProps = {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  publicOrderId: string;
  amount: number;
  currency: string;
  customerEmail?: string;
  isAmbiguous?: boolean;
  ambiguityReason?: string;
  onSuccess?: () => void;
};

const REFUND_REASONS = [
  "Non-deliverable service / invalid link",
  "Provider rejected without charge",
  "Service permanently discontinued",
  "Customer target fix token expired",
  "Customer service accommodation",
  "Other administrative resolution",
];

export function AdminRefundModal({
  isOpen,
  onClose,
  orderId,
  publicOrderId,
  amount,
  currency,
  customerEmail,
  isAmbiguous = false,
  ambiguityReason,
  onSuccess,
}: AdminRefundModalProps) {
  const router = useRouter();
  const [selectedReason, setSelectedReason] = useState(REFUND_REASONS[0]);
  const [customReason, setCustomReason] = useState("");
  const [confirmedProviderCheck, setConfirmedProviderCheck] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isAmbiguous && !confirmedProviderCheck) {
      setError("You must confirm you verified no order exists at ReliableSMM.");
      return;
    }

    setLoading(true);
    setError(null);

    const finalReason = selectedReason === "Other administrative resolution" && customReason.trim()
      ? customReason.trim()
      : selectedReason;

    try {
      const res = await fetch(`/api/admin/orders/${orderId}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: finalReason,
          forceAmbiguous: isAmbiguous && confirmedProviderCheck,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to process refund");
      }

      setSuccessMessage(data.message || "Refund successfully credited to customer wallet.");
      setTimeout(() => {
        router.refresh();
        onClose();
        if (onSuccess) onSuccess();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refund failed");
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
      aria-labelledby="refund-modal-title"
    >
      <div
        style={{
          backgroundColor: "#12141c",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: "12px",
          maxWidth: "520px",
          width: "100%",
          padding: "24px",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.5)",
          color: "#fff",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2 id="refund-modal-title" style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>
            Refund Order #{publicOrderId}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            style={{
              background: "none",
              border: "none",
              color: "rgba(255, 255, 255, 0.5)",
              fontSize: "20px",
              cursor: "pointer",
              padding: "4px 8px",
            }}
          >
            ✕
          </button>
        </div>

        {successMessage ? (
          <div
            style={{
              padding: "16px",
              borderRadius: "8px",
              backgroundColor: "rgba(72, 187, 120, 0.15)",
              border: "1px solid rgba(72, 187, 120, 0.3)",
              color: "#48bb78",
              fontSize: "14px",
              textAlign: "center",
              margin: "16px 0",
            }}
          >
            ✓ {successMessage}
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: "16px", padding: "12px", background: "rgba(255, 255, 255, 0.04)", borderRadius: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px", fontSize: "13px", color: "rgba(255, 255, 255, 0.6)" }}>
                <span>Customer:</span>
                <span style={{ color: "#fff", fontWeight: 500 }}>{customerEmail || "Customer"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", color: "rgba(255, 255, 255, 0.6)" }}>
                <span>Refund Amount:</span>
                <span style={{ color: "#48bb78", fontWeight: 700, fontSize: "15px" }}>
                  {currency} {amount.toFixed(2)}
                </span>
              </div>
              <div style={{ marginTop: "6px", fontSize: "11px", color: "rgba(255, 255, 255, 0.4)" }}>
                Credits customer VANTA wallet ledger atomically. Cannot be undone.
              </div>
            </div>

            {isAmbiguous && (
              <div
                style={{
                  marginBottom: "16px",
                  padding: "12px",
                  borderRadius: "8px",
                  backgroundColor: "rgba(237, 137, 54, 0.12)",
                  border: "1px solid rgba(237, 137, 54, 0.3)",
                  color: "#ed8936",
                  fontSize: "13px",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: "4px" }}>⚠️ Ambiguous Order State</div>
                <div style={{ marginBottom: "8px", lineHeight: 1.4, fontSize: "12px", color: "rgba(255,255,255,0.8)" }}>
                  {ambiguityReason || "This order timed out or is awaiting reconciliation. It may have crossed to the provider."}
                </div>
                <label style={{ display: "flex", alignItems: "flex-start", gap: "8px", cursor: "pointer", fontSize: "12px", color: "#fff" }}>
                  <input
                    type="checkbox"
                    checked={confirmedProviderCheck}
                    onChange={(e) => setConfirmedProviderCheck(e.target.checked)}
                    style={{ marginTop: "2px" }}
                  />
                  <span>
                    <strong>I verified in ReliableSMM</strong> that no active order was placed or charged for this order.
                  </span>
                </label>
              </div>
            )}

            <div style={{ marginBottom: "16px" }}>
              <label htmlFor="refund-reason" style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "6px" }}>
                Refund Reason:
              </label>
              <select
                id="refund-reason"
                value={selectedReason}
                onChange={(e) => setSelectedReason(e.target.value)}
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
                {REFUND_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            {selectedReason === "Other administrative resolution" && (
              <div style={{ marginBottom: "16px" }}>
                <label htmlFor="custom-reason" style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "6px" }}>
                  Specify Reason:
                </label>
                <input
                  id="custom-reason"
                  type="text"
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="Reason logged in audit trail..."
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
            )}

            {error && (
              <div
                style={{
                  padding: "10px",
                  borderRadius: "6px",
                  backgroundColor: "rgba(229, 62, 62, 0.15)",
                  border: "1px solid rgba(229, 62, 62, 0.3)",
                  color: "#fc8181",
                  fontSize: "13px",
                  marginBottom: "16px",
                }}
              >
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
                disabled={loading || (isAmbiguous && !confirmedProviderCheck)}
                style={{
                  padding: "10px 18px",
                  borderRadius: "6px",
                  backgroundColor: isAmbiguous ? "#d97706" : "#6366f1",
                  border: "none",
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: "13px",
                  cursor: loading || (isAmbiguous && !confirmedProviderCheck) ? "not-allowed" : "pointer",
                  opacity: loading || (isAmbiguous && !confirmedProviderCheck) ? 0.6 : 1,
                }}
              >
                {loading ? "Processing..." : `Confirm Refund (${currency} ${amount.toFixed(2)})`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
