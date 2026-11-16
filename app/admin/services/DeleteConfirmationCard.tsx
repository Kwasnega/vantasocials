"use client";

import { useState } from "react";

export function DeleteConfirmationCard({
  title,
  description,
  warning,
  confirmLabel,
  busyLabel,
  busy,
  error,
  requiredWord,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  warning: string;
  confirmLabel: string;
  busyLabel: string;
  busy: boolean;
  error: string | null;
  requiredWord?: string;
  onCancel: () => void;
  onConfirm: (typedConfirmation: string) => void;
}) {
  const [typed, setTyped] = useState("");
  const isBlocked = requiredWord ? typed.trim() !== requiredWord : false;

  return (
    <section className="admin-delete-confirmation" aria-label={title}>
      <div>
        <p className="dashboard-kicker">CONFIRM DELETION</p>
        <h3>{title}</h3>
        <p>{description}</p>
        <p className="admin-delete-warning">{warning}</p>
        {requiredWord && (
          <div style={{ marginTop: "12px", marginBottom: "12px" }}>
            <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#e2d9eb", marginBottom: "4px" }}>
              Type <strong style={{ color: "#f87171" }}>{requiredWord}</strong> to confirm:
            </label>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={requiredWord}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid rgba(255,255,255,0.2)",
                background: "#160c22",
                color: "#fff",
                fontSize: "13px",
              }}
            />
          </div>
        )}
        {error && <p className="admin-delete-error" role="alert">{error}</p>}
      </div>
      <div className="admin-delete-confirmation-actions">
        <button type="button" className="admin-delete-cancel" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="admin-delete-confirm"
          onClick={() => onConfirm(typed)}
          disabled={busy || isBlocked}
        >
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </section>
  );
}
