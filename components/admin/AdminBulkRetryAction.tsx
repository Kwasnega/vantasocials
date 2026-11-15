"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdminBulkRetryAction({
  insufficientFundsCount,
}: {
  insufficientFundsCount: number;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [progressStatus, setProgressStatus] = useState<string | null>(null);

  if (insufficientFundsCount <= 0) {
    return null;
  }

  async function handleBulkRetry() {
    setLoading(true);
    setProgressStatus("Starting bulk retry in chunks...");
    let cursor: string | null = null;
    let totalProcessed = 0;
    let totalSucceeded = 0;
    let totalFailed = 0;
    let totalSkipped = 0;

    try {
      while (true) {
        const res: Response = await fetch("/api/admin/orders/retry-bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cursor }),
        });

        const data: {
          error?: string;
          processed?: number;
          succeeded?: number;
          failed?: number;
          skippedInsufficientBalance?: number;
          hasMore?: boolean;
          nextCursor?: string | null;
        } = await res.json();

        if (!res.ok) {
          setProgressStatus(`Error: ${data.error || "Bulk retry failed."}`);
          break;
        }

        totalProcessed += data.processed ?? 0;
        totalSucceeded += data.succeeded ?? 0;
        totalFailed += data.failed ?? 0;
        totalSkipped += data.skippedInsufficientBalance ?? 0;

        setProgressStatus(
          `Processed: ${totalProcessed} (${totalSucceeded} ok, ${totalFailed} failed, ${totalSkipped} low balance)...`
        );

        if (data.hasMore && data.nextCursor) {
          cursor = data.nextCursor;
          // Short pause between chunks
          await new Promise((r) => setTimeout(r, 400));
        } else {
          setProgressStatus(
            `Completed: ${totalProcessed} orders processed (${totalSucceeded} succeeded, ${totalFailed} failed, ${totalSkipped} skipped).`
          );
          break;
        }
      }

      setShowConfirm(false);
      router.refresh();
    } catch (err) {
      setProgressStatus(err instanceof Error ? err.message : "Network error during bulk retry");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "inline-block", position: "relative" }}>
      {!showConfirm ? (
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          disabled={loading}
          style={{
            background: "linear-gradient(135deg, #ff8c00, #ff5500)",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            padding: "6px 14px",
            fontSize: "12px",
            fontWeight: 800,
            cursor: "pointer",
            boxShadow: "0 2px 8px rgba(255, 140, 0, 0.3)",
          }}
        >
          ⚡ Retry all failed ({insufficientFundsCount} provider funds)
        </button>
      ) : (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            background: "#1c1427",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: "8px",
            padding: "12px",
            zIndex: 100,
            width: "300px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
          }}
        >
          <p style={{ margin: "0 0 8px", fontSize: "12px", color: "#eee" }}>
            Retry up to <strong>{insufficientFundsCount} orders</strong> that failed due to insufficient provider balance?
          </p>
          <p style={{ margin: "0 0 10px", fontSize: "11px", color: "#aaa" }}>
            Processes in small chunks to ensure complete safety and fit serverless limits. Stops automatically if provider balance runs low.
          </p>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={handleBulkRetry}
              disabled={loading}
              style={{
                background: "#22c55e",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                padding: "4px 12px",
                fontSize: "11px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {loading ? "Processing..." : "Start Chunked Retry"}
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
                padding: "4px 12px",
                fontSize: "11px",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {progressStatus && (
        <span style={{ display: "block", fontSize: "11px", color: "#e2e8f0", marginTop: "4px" }}>
          {progressStatus}
        </span>
      )}
    </div>
  );
}
