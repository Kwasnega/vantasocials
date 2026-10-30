"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DeleteConfirmationCard } from "./DeleteConfirmationCard";

export function DeleteServiceButton({
  serviceId,
  serviceName,
}: {
  serviceId: string;
  serviceName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleDelete() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/services/${serviceId}`, {
        method: "DELETE",
      });
      const data: unknown = await res.json().catch(() => null);
      const result = data && typeof data === "object" && !Array.isArray(data)
        ? data as Record<string, unknown>
        : {};
      if (!res.ok) {
        setError(typeof result.error === "string" ? result.error : "Failed to delete service.");
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Error deleting service. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-delete-control">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setMessage(null);
          setConfirming(true);
        }}
        disabled={busy}
        title="Delete service"
        className="admin-delete-service"
        aria-expanded={confirming}
      >
        Delete
      </button>
      {confirming && (
        <DeleteConfirmationCard
          title={`Delete ${serviceName}?`}
          description="This permanently removes the service and all its configuration from the catalog."
          warning="Services with existing customer orders cannot be deleted."
          confirmLabel="Delete service"
          busyLabel="Deleting…"
          busy={busy}
          error={error}
          onCancel={() => setConfirming(false)}
          onConfirm={handleDelete}
        />
      )}
      {message && <p className="admin-delete-result" role="status">{message}</p>}
    </div>
  );
}
