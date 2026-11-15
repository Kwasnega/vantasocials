"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type AdminBulkRefundModalProps = {
  isOpen: boolean;
  onClose: () => void;
  eligibleOrders: Array<{
    id: string;
    publicOrderId: string;
    amount: number;
    currency: string;
  }>;
  onSuccess?: () => void;
};

export function AdminBulkRefundModal({
  isOpen,
  onClose,
  eligibleOrders,
  onSuccess,
}: AdminBulkRefundModalProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultSummary, setResultSummary] = useState<{
    total: number;
    refundedCount: number;
    skippedCount: number;
    totalRefundedAmount: number;
  } | null>(null);

  if (!isOpen) return null;

  const totalAmount = eligibleOrders.reduce((sum, o) => sum + (o.amount || 0), 0);

  async function handleBulkRefund() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/orders/bulk-refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds: eligibleOrders.map((o) => o.id),
          reason: "Bulk admin refund of eligible failed orders",
          forceAmbiguous: false, // Never force ambiguous in bulk
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to process bulk refund");
      }

      setResultSummary({
        total: data.total,
        refundedCount: data.refundedCount,
        skippedCount: data.skippedCount,
        totalRefundedAmount: data.totalRefundedAmount,
      });

      setTimeout(() => {
        router.refresh();
        if (onSuccess) onSuccess();
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk refund failed");
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
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.5)",
          color: "#fff",
        }}
      >
        <h2 style={{ margin: "0 0 16px", fontSize: "18px", fontWeight: 600 }}>
          Bulk Refund Eligible Orders
        </h2>

        {resultSummary ? (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <div style={{ fontSize: "28px", color: "#48bb78", marginBottom: "8px" }}>✓</div>
            <div style={{ fontSize: "16px", fontWeight: 600, color: "#fff", marginBottom: "8px" }}>
              Bulk Refund Completed
            </div>
            <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.7)", margin: "0 0 16px" }}>
              Successfully refunded <strong>{resultSummary.refundedCount}</strong> orders (total GHS{" "}
              {resultSummary.totalRefundedAmount.toFixed(2)}).
              {resultSummary.skippedCount > 0 && ` (${resultSummary.skippedCount} skipped)`}
            </p>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "8px 20px",
                borderRadius: "6px",
                backgroundColor: "#6366f1",
                border: "none",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Done
            </button>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.7)", lineHeight: 1.5, margin: "0 0 16px" }}>
              You are about to refund <strong>{eligibleOrders.length}</strong> eligible failed orders directly to
              their respective customers' VANTA wallets.
            </p>

            <div style={{ padding: "12px", backgroundColor: "rgba(255,255,255,0.05)", borderRadius: "8px", marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "4px" }}>
                <span>Eligible Orders:</span>
                <span style={{ fontWeight: 600 }}>{eligibleOrders.length}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                <span>Total Amount:</span>
                <span style={{ fontWeight: 700, color: "#48bb78" }}>GHS {totalAmount.toFixed(2)}</span>
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
                type="button"
                onClick={handleBulkRefund}
                disabled={loading || eligibleOrders.length === 0}
                style={{
                  padding: "10px 18px",
                  borderRadius: "6px",
                  backgroundColor: "#6366f1",
                  border: "none",
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: "13px",
                  cursor: loading ? "not-allowed" : "pointer",
                }}
              >
                {loading ? "Processing..." : `Refund ${eligibleOrders.length} Orders (GHS ${totalAmount.toFixed(2)})`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
