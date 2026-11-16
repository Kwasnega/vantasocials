"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DeleteConfirmationCard } from "../../app/admin/services/DeleteConfirmationCard";

export function AdminOrderRowActions({
  orderId,
  isArchived,
  paymentStatus,
}: {
  orderId: string;
  isArchived: boolean;
  paymentStatus: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleArchiveToggle() {
    setBusy(true);
    setError(null);
    try {
      const endpoint = isArchived
        ? `/api/admin/orders/${orderId}/restore`
        : `/api/admin/orders/${orderId}/archive`;
      const res = await fetch(endpoint, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Action failed.");
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error performing action.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(typedConfirmation: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: typedConfirmation }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed to delete order.");
        return;
      }
      setConfirmingDelete(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error deleting order.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
      <button
        type="button"
        onClick={handleArchiveToggle}
        disabled={busy}
        title={isArchived ? "Restore order to active queue" : "Archive order"}
        style={{
          background: "transparent",
          border: "1px solid rgba(255,255,255,0.15)",
          color: isArchived ? "#34d399" : "#a99bb2",
          borderRadius: "6px",
          padding: "2px 6px",
          fontSize: "11px",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {isArchived ? "Restore" : "Archive"}
      </button>

      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirmingDelete(true);
        }}
        disabled={busy}
        title="Permanently delete order"
        style={{
          background: "transparent",
          border: "1px solid rgba(239, 68, 68, 0.25)",
          color: "#f87171",
          borderRadius: "6px",
          padding: "2px 6px",
          fontSize: "11px",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Delete
      </button>

      {confirmingDelete && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.6)", display: "grid", placeItems: "center", padding: "16px" }}>
          <div style={{ maxWidth: "440px", width: "100%" }}>
            <DeleteConfirmationCard
              title="Delete Order Permanently?"
              description={
                paymentStatus === "PAID"
                  ? "This permanently hides the order. Wallet ledger and payment records will lose the order link but remain intact."
                  : "This will remove the unpaid checkout record permanently."
              }
              warning="This action cannot be undone."
              requiredWord="DELETE"
              confirmLabel="Delete permanently"
              busyLabel="Deleting…"
              busy={busy}
              error={error}
              onCancel={() => setConfirmingDelete(false)}
              onConfirm={handleDelete}
            />
          </div>
        </div>
      )}
    </div>
  );
}
