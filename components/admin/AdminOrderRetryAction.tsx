"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdminOrderRetryAction({
  orderId,
  publicOrderId,
  failureReason,
  canForce = false,
  isEligible = true,
}: {
  orderId: string;
  publicOrderId: string;
  failureReason?: string | null;
  canForce?: boolean;
  isEligible?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const isAmbiguous = canForce && !isEligible;

  async function handleRetry(force = false) {
    setLoading(true);
    setResultMessage(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResultMessage(data.error || "Retry failed.");
      } else {
        setResultMessage(`Result: ${data.outcome} - ${data.message}`);
        setShowConfirm(false);
        router.refresh();
      }
    } catch (err) {
      setResultMessage(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  if (!isEligible && !canForce) {
    return null;
  }

  return (
    <div style={{ display: "inline-block", position: "relative" }}>
      {!showConfirm ? (
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          disabled={loading}
          style={{
            background: isAmbiguous ? "#d69e2e" : "#ff8c00",
            color: "#0f0716",
            border: "none",
            borderRadius: "6px",
            padding: "3px 8px",
            fontSize: "11px",
            fontWeight: 800,
            cursor: "pointer",
            marginTop: "3px",
          }}
        >
          {loading ? "Retrying..." : isAmbiguous ? "Force Retry ⚠️" : "Retry Fulfillment"}
        </button>
      ) : (
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            left: 0,
            background: "#1c1427",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: "8px",
            padding: "10px",
            zIndex: 100,
            width: "240px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
          }}
        >
          <p style={{ margin: "0 0 6px", fontSize: "11px", color: "#eee" }}>
            {isAmbiguous
              ? `⚠️ Order timed out or was rejected previously (${failureReason ?? "unknown"}). Check ReliableSMM to ensure no duplicate charge before proceeding!`
              : `Submit ${publicOrderId} to ReliableSMM now? No customer re-charge will occur.`}
          </p>
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              type="button"
              onClick={() => handleRetry(isAmbiguous)}
              disabled={loading}
              style={{
                background: isAmbiguous ? "#e53e3e" : "#22c55e",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                padding: "3px 8px",
                fontSize: "11px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {loading ? "Sending..." : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setShowConfirm(false)}
              disabled={loading}
              style={{
                background: "transparent",
                color: "#aaa",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "4px",
                padding: "3px 8px",
                fontSize: "11px",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {resultMessage && (
        <span style={{ display: "block", fontSize: "10px", color: "#ccc", marginTop: "2px" }}>
          {resultMessage}
        </span>
      )}
    </div>
  );
}
