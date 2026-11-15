"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type CustomerStatusModalProps = {
  isOpen: boolean;
  onClose: () => void;
  customerId: string;
  currentStatus: "ACTIVE" | "FLAGGED" | "SUSPENDED";
  customerEmail: string;
};

export function CustomerStatusModal({
  isOpen,
  onClose,
  customerId,
  currentStatus,
  customerEmail,
}: CustomerStatusModalProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"ACTIVE" | "FLAGGED" | "SUSPENDED">(
    currentStatus === "SUSPENDED" ? "ACTIVE" : "SUSPENDED"
  );
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError("Please specify a reason for changing account status.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update account status");

      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
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
        <h2 style={{ margin: "0 0 12px", fontSize: "18px" }}>Manage Account Status</h2>
        <p style={{ color: "rgba(255,255,255,0.7)", fontSize: "13px", margin: "0 0 16px" }}>
          Updating status for <strong>{customerEmail}</strong>.
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "6px" }}>
              Target Status:
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as "ACTIVE" | "FLAGGED" | "SUSPENDED")}
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
              <option value="ACTIVE">ACTIVE (Normal full access)</option>
              <option value="FLAGGED">FLAGGED (Monitored for review)</option>
              <option value="SUSPENDED">SUSPENDED (Blocks ordering & deposits)</option>
            </select>
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "6px" }}>
              Reason for status change:
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Chargeback dispute, suspicious automated activity, resolved identity check..."
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
                backgroundColor: status === "SUSPENDED" ? "#ef4444" : status === "FLAGGED" ? "#f59e0b" : "#10b981",
                border: "none",
                color: "#fff",
                fontWeight: 600,
                fontSize: "13px",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Updating..." : `Set Status to ${status}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
