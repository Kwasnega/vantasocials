"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function BalanceRefresh() {
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
  return <div><button type="button" onClick={refresh} disabled={busy}>{busy ? "Refreshing…" : "Refresh balance"}</button>{message && <small role="status">{message}</small>}</div>;
}
