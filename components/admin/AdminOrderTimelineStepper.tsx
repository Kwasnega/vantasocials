"use client";

import { useState } from "react";

export type PersistedTimelineEvent = {
  id: string;
  type: string;
  status_before: string | null;
  status_after: string | null;
  message: string | null;
  meta: Record<string, unknown> | null;
  actor: string | null;
  created_at: string;
};

// Distinct stages in the vertical stepper
const STAGES = [
  { key: "created", label: "Created", matchTypes: ["created"] },
  { key: "payment", label: "Payment Confirmed", matchTypes: ["payment_confirmed"] },
  { key: "submitted", label: "Submitted to Provider", matchTypes: ["submitted_to_provider", "provider_accepted"] },
  { key: "processing", label: "In Progress", matchTypes: ["in_progress", "status_synced"] },
  { key: "completed", label: "Completed", matchTypes: ["completed"] },
];

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function AdminOrderTimelineStepper({
  events,
  currentStatus,
  failureReason,
}: {
  events: PersistedTimelineEvent[];
  currentStatus: string;
  failureReason?: string | null;
}) {
  const [expandedMeta, setExpandedMeta] = useState<Record<string, boolean>>({});

  function toggleMeta(id: string) {
    setExpandedMeta((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  // Determine stage progression strictly from persisted events
  const stageTimestamps: Record<string, string> = {};
  for (const s of STAGES) {
    const match = events.find((e) => s.matchTypes.includes(e.type));
    if (match) stageTimestamps[s.key] = match.created_at;
  }

  const isFailed = currentStatus === "FAILED" || Boolean(failureReason);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* 1. Stage Stepper */}
      <div
        style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "12px",
          padding: "20px",
        }}
      >
        <h3 style={{ margin: "0 0 16px", fontSize: "14px", color: "#eee", letterSpacing: "0.05em" }}>
          LIFECYCLE PROGRESSION (PERSISTED STAGES)
        </h3>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
          {STAGES.map((stage, idx) => {
            const timestamp = stageTimestamps[stage.key];
            const isCompleted = Boolean(timestamp);
            const prevStage = idx > 0 ? STAGES[idx - 1] : null;
            const prevTimestamp = prevStage ? stageTimestamps[prevStage.key] : null;

            let durationText = "";
            if (timestamp && prevTimestamp) {
              const diff = new Date(timestamp).getTime() - new Date(prevTimestamp).getTime();
              if (diff > 0) durationText = `+${formatDuration(diff)}`;
            }

            return (
              <div
                key={stage.key}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  flex: "1 1 140px",
                  position: "relative",
                  padding: "10px",
                  borderRadius: "8px",
                  background: isCompleted ? "rgba(34,197,94,0.05)" : "rgba(255,255,255,0.02)",
                  border: isCompleted ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(255,255,255,0.05)",
                }}
              >
                <div
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 800,
                    fontSize: "12px",
                    background: isCompleted ? "#22c55e" : "rgba(255,255,255,0.1)",
                    color: isCompleted ? "#06240d" : "#888",
                    marginBottom: "6px",
                  }}
                >
                  {isCompleted ? "✓" : idx + 1}
                </div>
                <strong style={{ fontSize: "12px", color: isCompleted ? "#22c55e" : "#888", textAlign: "center" }}>
                  {stage.label}
                </strong>
                {timestamp ? (
                  <span style={{ fontSize: "10px", color: "#aaa", marginTop: "4px", textAlign: "center" }}>
                    {new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                ) : (
                  <span style={{ fontSize: "10px", color: "#555", marginTop: "4px" }}>Pending</span>
                )}
                {durationText && (
                  <span
                    style={{
                      fontSize: "9px",
                      color: "#93c5fd",
                      background: "rgba(59,130,246,0.1)",
                      padding: "1px 4px",
                      borderRadius: "4px",
                      marginTop: "3px",
                    }}
                  >
                    {durationText}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {isFailed && (
          <div
            style={{
              marginTop: "16px",
              padding: "10px 14px",
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: "8px",
              color: "#fca5a5",
              fontSize: "12px",
            }}
          >
            <strong>FAILED STAGE:</strong> {failureReason ? `Fulfillment failed (${failureReason})` : "Order failed"}
          </div>
        )}
      </div>

      {/* 2. Full Chronological Event Log */}
      <div
        style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "12px",
          padding: "20px",
        }}
      >
        <h3 style={{ margin: "0 0 16px", fontSize: "14px", color: "#eee", letterSpacing: "0.05em" }}>
          PERSISTED CHRONOLOGICAL EVENT LOG ({events.length} EVENTS)
        </h3>

        {events.length === 0 ? (
          <p style={{ color: "#888", fontSize: "12px", margin: 0 }}>
            No persisted events recorded for this order yet.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {events.map((ev, i) => {
              const prevEv = i > 0 ? events[i - 1] : null;
              let stepDelta = "";
              if (prevEv) {
                const diff = new Date(ev.created_at).getTime() - new Date(prevEv.created_at).getTime();
                if (diff > 0) stepDelta = `+${formatDuration(diff)}`;
              }

              const hasMeta = ev.meta && Object.keys(ev.meta).length > 0;
              const isMetaExpanded = Boolean(expandedMeta[ev.id]);

              return (
                <div
                  key={ev.id}
                  style={{
                    padding: "10px 14px",
                    borderRadius: "8px",
                    background: ev.type === "admin_note" ? "rgba(139,92,246,0.08)" : "rgba(255,255,255,0.02)",
                    border:
                      ev.type === "admin_note"
                        ? "1px solid rgba(139,92,246,0.3)"
                        : ev.type === "failed"
                        ? "1px solid rgba(239,68,68,0.3)"
                        : "1px solid rgba(255,255,255,0.05)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 800,
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background: "rgba(255,255,255,0.1)",
                          color: "#eee",
                          textTransform: "uppercase",
                        }}
                      >
                        {ev.type}
                      </span>
                      <strong style={{ fontSize: "13px", color: ev.type === "failed" ? "#f87171" : "#fff" }}>
                        {ev.message || ev.type}
                      </strong>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", color: "#888" }}>
                      {stepDelta && (
                        <span style={{ color: "#93c5fd", background: "rgba(59,130,246,0.1)", padding: "1px 5px", borderRadius: "4px" }}>
                          {stepDelta}
                        </span>
                      )}
                      <span>{new Date(ev.created_at).toLocaleString()}</span>
                      {ev.actor && <span style={{ color: "#c084fc" }}>({ev.actor})</span>}
                    </div>
                  </div>

                  {hasMeta && (
                    <div style={{ marginTop: "6px" }}>
                      <button
                        type="button"
                        onClick={() => toggleMeta(ev.id)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#60a5fa",
                          fontSize: "11px",
                          cursor: "pointer",
                          padding: 0,
                          textDecoration: "underline",
                        }}
                      >
                        {isMetaExpanded ? "Hide meta details ▲" : "Show meta details ▼"}
                      </button>
                      {isMetaExpanded && (
                        <pre
                          style={{
                            marginTop: "6px",
                            padding: "8px",
                            borderRadius: "6px",
                            background: "rgba(0,0,0,0.5)",
                            fontSize: "11px",
                            color: "#a7f3d0",
                            overflowX: "auto",
                          }}
                        >
                          {JSON.stringify(ev.meta, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
