"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DeleteConfirmationCard } from "./DeleteConfirmationCard";

export function DeletePlatformButton({
  platformId,
  platformName,
  servicesCount,
}: {
  platformId: string;
  platformName: string;
  servicesCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const serviceText = servicesCount === 1 ? "1 service" : `${servicesCount} services`;

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/platforms/${platformId}`, {
        method: "DELETE",
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const message = body && typeof body === "object" && !Array.isArray(body) &&
          "error" in body && typeof body.error === "string"
          ? body.error
          : "Unable to delete platform.";
        setError(message);
        return;
      }

      setConfirming(false);
      router.refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete platform. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-delete-control admin-delete-platform-control">
      <button
        type="button"
        className="service-delete-platform"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        disabled={busy}
        aria-label={`Delete ${platformName} platform`}
        title={`Delete ${platformName} platform`}
        aria-expanded={confirming}
      >
        {busy ? "…" : (
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 6h12m-10 0 .7 10h6.6L14 6M8 6V4h4v2m-3 3v4m2-4v4" />
          </svg>
        )}
        <span>Delete</span>
      </button>
      {confirming && (
        <DeleteConfirmationCard
          title={`Delete ${platformName}?`}
          description={`Permanently remove this platform and its ${serviceText}, including their catalog configuration.`}
          warning="Deletion is blocked if any service has order history. This action cannot be undone."
          confirmLabel="Delete platform"
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
