"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DeleteConfirmationCard } from "../services/DeleteConfirmationCard";

export function DeleteProviderButton({
  provider,
  serviceCount,
}: {
  provider: string;
  serviceCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(typedConfirmation: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/providers/${provider}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: typedConfirmation }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed to delete provider.");
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error deleting provider.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: "16px", paddingTop: "14px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        disabled={busy}
        className="admin-delete-service"
        style={{
          background: "rgba(239, 68, 68, 0.12)",
          color: "#f87171",
          border: "1px solid rgba(239, 68, 68, 0.3)",
          padding: "6px 14px",
          borderRadius: "8px",
          fontSize: "12px",
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Delete provider & all services
      </button>

      {confirming && (
        <DeleteConfirmationCard
          title={`Delete provider ${provider}?`}
          description={`This removes ${serviceCount} service(s) under this provider. Orders will be kept but will show these services as removed.`}
          warning="Customers will no longer be able to order any services from this provider."
          requiredWord="DELETE"
          confirmLabel="Delete provider"
          busyLabel="Deleting…"
          busy={busy}
          error={error}
          onCancel={() => setConfirming(false)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
