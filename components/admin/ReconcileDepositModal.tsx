"use client";

import { useState } from "react";

export type ReconcileDepositModalProps = {
  isOpen: boolean;
  onClose: () => void;
  deposit: {
    id: string;
    reference: string;
    amount: number;
    currency: string;
  } | null;
  customerId: string;
  ledger: Array<{
    id: string;
    type: string;
    direction: string;
    amount: number;
    currency: string;
    reference: string;
  }>;
  onSuccess: () => void;
};

export function ReconcileDepositModal({
  isOpen,
  onClose,
  deposit,
  customerId,
  ledger,
  onSuccess,
}: ReconcileDepositModalProps) {
  const [note, setNote] = useState("");
  const [linkedTxId, setLinkedTxId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !deposit) return null;

  // Filter manual adjustment credits as suggestions
  const manualCredits = ledger.filter(
    (tx) => tx.type === "MANUAL_ADJUSTMENT" && tx.direction === "CREDIT"
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) {
      setError("Please provide an explanatory note.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/admin/customers/${customerId}/wallet/deposits/${deposit?.id}/reconcile`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            note: note.trim(),
            linked_transaction_id: linkedTxId.trim() || undefined,
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to mark reconciled");

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error reconciling deposit");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "16px",
      }}
    >
      <div
        style={{
          backgroundColor: "#161922",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          borderRadius: "12px",
          width: "100%",
          maxWidth: "520px",
          padding: "24px",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2 style={{ fontSize: "18px", margin: 0, color: "#fff" }}>
            Mark Deposit as Reconciled
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.6)",
              fontSize: "20px",
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.7)", lineHeight: 1.5, marginBottom: "16px" }}>
          Use this when you have <strong>already compensated</strong> the customer manually (e.g. via manual adjustment or cash). This marks the deposit as reconciled <em>without adding another credit to the wallet</em>, permanently preventing double-crediting.
        </p>

        <div style={{ padding: "12px", backgroundColor: "rgba(255,255,255,0.04)", borderRadius: "8px", marginBottom: "16px", fontSize: "13px" }}>
          <div><strong>Deposit Reference:</strong> <code style={{ fontSize: "12px" }}>{deposit.reference}</code></div>
          <div><strong>Deposit Amount:</strong> {deposit.currency} {deposit.amount.toFixed(2)}</div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "14px" }}>
            <label style={{ display: "block", fontSize: "12px", color: "rgba(255,255,255,0.7)", marginBottom: "4px" }}>
              Link to existing Manual Credit Ledger Entry (Optional)
            </label>
            <select
              value={linkedTxId}
              onChange={(e) => setLinkedTxId(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: "6px",
                backgroundColor: "#1f2330",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                color: "#fff",
                fontSize: "13px",
              }}
            >
              <option value="">-- None / Select ledger entry --</option>
              {manualCredits.map((tx) => (
                <option key={tx.id} value={tx.id}>
                  +{tx.currency} {tx.amount.toFixed(2)} ({tx.reference.slice(0, 24)}...)
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: "12px", color: "rgba(255,255,255,0.7)", marginBottom: "4px" }}>
              Reconciliation Note (Required) *
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Customer was already given GHS 150 manual adjustment on Nov 15 covering this deposit."
              rows={3}
              required
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "6px",
                backgroundColor: "#1f2330",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                color: "#fff",
                fontSize: "13px",
              }}
            />
          </div>

          {error && (
            <div style={{ padding: "8px 12px", borderRadius: "6px", backgroundColor: "rgba(239, 68, 68, 0.15)", color: "#fca5a5", fontSize: "12px", marginBottom: "16px" }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: "8px 14px",
                borderRadius: "6px",
                background: "rgba(255,255,255,0.1)",
                border: "none",
                color: "#fff",
                fontSize: "13px",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: "8px 16px",
                borderRadius: "6px",
                backgroundColor: "#10b981",
                border: "none",
                color: "#fff",
                fontWeight: 600,
                fontSize: "13px",
                cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              {submitting ? "Reconciling..." : "✓ Confirm Reconciliation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
