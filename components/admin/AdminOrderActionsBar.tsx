"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CopyableValue({ label, value }: { label: string; value: string | number | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span>—</span>;

  const textVal = String(value);

  function copy() {
    navigator.clipboard.writeText(textVal);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
      <code style={{ background: "rgba(255,255,255,0.06)", padding: "2px 6px", borderRadius: "4px" }}>
        {textVal}
      </code>
      <button
        type="button"
        onClick={copy}
        title={`Copy ${label}`}
        style={{
          background: "transparent",
          border: "1px solid rgba(255,255,255,0.2)",
          color: copied ? "#22c55e" : "#aaa",
          borderRadius: "4px",
          padding: "1px 6px",
          fontSize: "11px",
          cursor: "pointer",
        }}
      >
        {copied ? "✓ Copied" : "Copy"}
      </button>
    </span>
  );
}

export function AdminOrderActionsBar({
  orderId,
  publicOrderId,
  hasProviderOrder,
}: {
  orderId: string;
  publicOrderId: string;
  hasProviderOrder: boolean;
}) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [addingNote, setAddingNote] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function handleRefresh() {
    setRefreshing(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/refresh-provider`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage(`Error: ${data.error || "Refresh failed"}`);
      } else {
        setMessage(`Provider status refreshed: ${data.result?.status ?? data.result?.outcome}`);
        router.refresh();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Network error");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setAddingNote(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: noteText.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(`Error: ${data.error || "Failed to add note"}`);
      } else {
        setMessage("Admin note recorded to timeline.");
        setNoteText("");
        router.refresh();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Network error");
    } finally {
      setAddingNote(false);
    }
  }

  return (
    <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
        {hasProviderOrder && (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            style={{
              background: "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              padding: "6px 12px",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {refreshing ? "Refreshing..." : "↻ Refresh status from provider"}
          </button>
        )}
      </div>

      <form onSubmit={handleAddNote} style={{ display: "flex", gap: "8px", maxWidth: "600px" }}>
        <input
          type="text"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Add an internal admin note to this order's timeline..."
          style={{
            flex: 1,
            padding: "6px 10px",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: "6px",
            color: "#fff",
            fontSize: "12px",
          }}
        />
        <button
          type="submit"
          disabled={addingNote || !noteText.trim()}
          style={{
            background: "#8b5cf6",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            padding: "6px 14px",
            fontSize: "12px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {addingNote ? "Saving..." : "Add Note"}
        </button>
      </form>

      {message && (
        <span style={{ fontSize: "12px", color: "#93c5fd" }}>{message}</span>
      )}
    </div>
  );
}
