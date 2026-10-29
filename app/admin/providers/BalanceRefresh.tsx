"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function BalanceRefresh({ label = "Refresh balance" }: { label?: string }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function refresh() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/providers/reliablesmm/balance", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Balance refresh failed.");
      setMessage("Balance refreshed.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Balance refresh failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ display: "grid", justifyItems: "start", gap: 6, marginTop: 12 }}>
      <button
        type="button"
        onClick={refresh}
        disabled={busy}
        style={{ padding: "9px 13px", border: 0, borderRadius: 9, color: "#170529", background: "#d883ff", font: "inherit", fontSize: 12, fontWeight: 800, cursor: busy ? "wait" : "pointer" }}
      >
        {busy ? "Refreshing…" : label}
      </button>
      {message && <small role="status">{message}</small>}
    </div>
  );
}
