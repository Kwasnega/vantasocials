"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdminEditBalanceModal({
  isOpen,
  onClose,
  customerId,
  customerEmail,
  currentBalanceGhs,
  currency = "GHS",
}: {
  isOpen: boolean;
  onClose: () => void;
  customerId: string;
  customerEmail: string;
  currentBalanceGhs: number;
  currency?: string;
}) {
  const router = useRouter();
  const [newBalance, setNewBalance] = useState(String(currentBalanceGhs.toFixed(2)));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const targetNum = Number(newBalance);
  const diff = !isNaN(targetNum) ? targetNum - currentBalanceGhs : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isNaN(targetNum) || targetNum < 0) {
      setError("Please enter a valid non-negative balance.");
      return;
    }
    if (!reason.trim() || reason.trim().length < 10) {
      setError("A descriptive note of at least 10 characters explaining the balance adjustment is required.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/customers/${customerId}/wallet/edit-balance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_balance: targetNum,
          reason: reason.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update balance.");
      }

      setSuccess(true);
      setTimeout(() => {
        router.refresh();
        onClose();
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update balance.");
    } finally {
      setBusy(false);
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
      aria-labelledby="edit-balance-title"
    >
      <div
        style={{
          backgroundColor: "#160c22",
          border: "1px solid #352244",
          borderRadius: "16px",
          padding: "24px",
          width: "100%",
          maxWidth: "460px",
          color: "#fff",
          boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
        }}
      >
        <p className="dashboard-kicker" style={{ margin: 0, fontSize: "11px", color: "#d883ff" }}>
          CUSTOMER WALLET CORRECTION
        </p>
        <h2 id="edit-balance-title" style={{ margin: "6px 0 16px", fontSize: "20px" }}>
          Edit Account Balance
        </h2>

        <p style={{ fontSize: "13px", color: "#a99bb2", margin: "0 0 16px" }}>
          Directly correct balance for <strong>{customerEmail}</strong> in case of mistake or refund discrepancy.
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div style={{ padding: "10px", background: "rgba(255,255,255,0.03)", borderRadius: "10px", border: "1px solid #2d183d" }}>
              <span style={{ fontSize: "11px", color: "#a99bb2", display: "block" }}>Current Balance</span>
              <strong style={{ fontSize: "18px", color: "#34d399" }}>
                {currency} {currentBalanceGhs.toFixed(2)}
              </strong>
            </div>
            <div style={{ padding: "10px", background: "rgba(255,255,255,0.03)", borderRadius: "10px", border: "1px solid #2d183d" }}>
              <span style={{ fontSize: "11px", color: "#a99bb2", display: "block" }}>Net Change</span>
              <strong style={{ fontSize: "18px", color: diff > 0 ? "#34d399" : diff < 0 ? "#f87171" : "#a99bb2" }}>
                {diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)} {currency}
              </strong>
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, marginBottom: "6px" }}>
              New Desired Balance ({currency})
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={newBalance}
              onChange={(e) => setNewBalance(e.target.value)}
              disabled={busy}
              required
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: "8px",
                border: "1px solid #453052",
                background: "#211034",
                color: "#fff",
                fontSize: "16px",
                fontWeight: 700,
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, marginBottom: "6px" }}>
              Reason for adjustment
            </label>
            <input
              type="text"
              placeholder="e.g. Corrected manual credit entry error"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
              required
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: "8px",
                border: "1px solid #453052",
                background: "#211034",
                color: "#fff",
                fontSize: "13px",
              }}
            />
          </div>

          {error && (
            <div style={{ padding: "10px 12px", borderRadius: "8px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", fontSize: "12px" }}>
              {error}
            </div>
          )}

          {success && (
            <div style={{ padding: "10px 12px", borderRadius: "8px", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)", color: "#34d399", fontSize: "12px" }}>
              ✓ Balance updated successfully.
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              style={{
                padding: "10px 16px",
                borderRadius: "8px",
                border: "1px solid rgba(255,255,255,0.15)",
                background: "transparent",
                color: "#e2d9eb",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !reason.trim() || isNaN(targetNum)}
              style={{
                padding: "10px 18px",
                borderRadius: "8px",
                border: "none",
                background: "#d883ff",
                color: "#170529",
                fontSize: "13px",
                fontWeight: 800,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              {busy ? "Saving..." : "Save New Balance"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
