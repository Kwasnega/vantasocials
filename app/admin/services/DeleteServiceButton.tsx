"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteServiceButton({
  serviceId,
  serviceName,
}: {
  serviceId: string;
  serviceName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!window.confirm(`Are you sure you want to delete "${serviceName}"? This cannot be undone.`)) {
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/services/${serviceId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to delete service.");
        return;
      }
      if (data.deactivated) {
        alert(data.message);
      }
      router.refresh();
    } catch {
      alert("Error deleting service.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={busy}
      title="Delete service"
      style={{
        background: "#321520",
        border: "1px solid #6b2639",
        color: "#ff9dab",
        padding: "8px 12px",
        borderRadius: "8px",
        fontSize: "12px",
        fontWeight: 700,
        cursor: busy ? "not-allowed" : "pointer",
        opacity: busy ? 0.5 : 1,
        transition: "all 0.15s ease",
      }}
    >
      {busy ? "Deleting…" : "Delete"}
    </button>
  );
}
