"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PublishServiceButton({
  serviceId,
  serviceName,
}: {
  serviceId: string;
  serviceName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePublish() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/services/${serviceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: true }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Failed to publish service.");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error publishing service.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: "4px" }}>
      <button
        type="button"
        onClick={handlePublish}
        disabled={busy}
        title={`Publish ${serviceName} to its platform card`}
        style={{
          background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
          color: "#fff",
          border: "none",
          borderRadius: "8px",
          padding: "8px 14px",
          fontSize: "12px",
          fontWeight: 700,
          cursor: busy ? "not-allowed" : "pointer",
          opacity: busy ? 0.7 : 1,
          transition: "all 0.2s ease",
          boxShadow: "0 2px 8px rgba(16, 185, 129, 0.25)",
        }}
      >
        {busy ? "Publishing…" : "✓ Publish / Show"}
      </button>
      {error && (
        <span style={{ color: "#ef4444", fontSize: "11px", fontWeight: 600 }}>
          {error}
        </span>
      )}
    </div>
  );
}
