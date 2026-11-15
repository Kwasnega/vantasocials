"use client";
import { useState } from "react";
import { validateMinDepositInput } from "../../../lib/settings/deposit-validation";

type MinDepositControlProps = {
  initialValue: number;
  initialUpdatedAt: string | null;
  initialUpdatedByEmail: string | null;
};

export function MinDepositControl({
  initialValue,
  initialUpdatedAt,
  initialUpdatedByEmail,
}: MinDepositControlProps) {
  const [currentValue, setCurrentValue] = useState(initialValue);
  const [updatedAt, setUpdatedAt] = useState<string | null>(initialUpdatedAt);
  const [updatedByEmail, setUpdatedByEmail] = useState<string | null>(initialUpdatedByEmail);

  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(initialValue.toFixed(2));
  const [isBusy, setIsBusy] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  function startEditing() {
    setInputValue(currentValue.toFixed(2));
    setToast(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    setIsEditing(false);
    setToast(null);
    setInputValue(currentValue.toFixed(2));
  }

  async function handleSave() {
    setToast(null);
    const check = validateMinDepositInput(inputValue);
    if (!check.valid) {
      setToast({ type: "error", message: check.error });
      return;
    }

    setIsBusy(true);
    try {
      const response = await fetch("/api/admin/settings/min-deposit", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ min_deposit_ghs: check.value }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to update minimum deposit.");
      }

      setCurrentValue(data.minDepositGhs);
      setUpdatedAt(data.updatedAt);
      if (data.updatedByEmail) {
        setUpdatedByEmail(data.updatedByEmail);
      }
      setIsEditing(false);
      setToast({ type: "success", message: `Minimum deposit updated to GHS ${Number(data.minDepositGhs).toFixed(2)}.` });
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to save changes." });
    } finally {
      setIsBusy(false);
    }
  }

  const formattedDate = updatedAt
    ? new Date(updatedAt).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <section className="admin-fx-settings" style={{ marginTop: "18px" }}>
      <div>
        <p className="dashboard-kicker">WALLET SETTINGS</p>
        <h2>Minimum Deposit</h2>
        <p>
          Current minimum deposit: <strong>₵ {currentValue.toFixed(2)} GHS</strong>
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {!isEditing ? (
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: "20px",
                fontWeight: 700,
                color: "#fff",
                background: "rgba(255,255,255,0.06)",
                padding: "8px 16px",
                borderRadius: "10px",
                border: "1px solid rgba(255,255,255,0.12)",
              }}
            >
              ₵ {currentValue.toFixed(2)} GHS
            </span>
            <button
              type="button"
              onClick={startEditing}
              style={{
                padding: "8px 18px",
                borderRadius: "10px",
                background: "#d883ff",
                color: "#170529",
                fontWeight: 800,
                fontSize: "13px",
                border: "none",
                cursor: "pointer",
              }}
            >
              Edit
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", margin: 0 }}>
              ₵{" "}
              <input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                inputMode="decimal"
                placeholder="35.00"
                aria-label="Minimum deposit amount in GHS"
                disabled={isBusy}
                style={{ width: "120px" }}
              />
            </label>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isBusy}
              style={{
                padding: "10px 16px",
                borderRadius: "10px",
                background: "#78dfb4",
                color: "#0a261b",
                fontWeight: 800,
                fontSize: "13px",
                border: "none",
                cursor: isBusy ? "not-allowed" : "pointer",
              }}
            >
              {isBusy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={cancelEditing}
              disabled={isBusy}
              style={{
                padding: "10px 16px",
                borderRadius: "10px",
                background: "transparent",
                color: "#cdbbd5",
                fontWeight: 600,
                fontSize: "13px",
                border: "1px solid #4a315b",
                cursor: isBusy ? "not-allowed" : "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        )}

        <small style={{ color: "#a99bb2", fontSize: "12px", display: "block" }}>
          {updatedAt ? (
            <>
              Last changed by <strong>{updatedByEmail ?? "Admin"}</strong> on {formattedDate}
            </>
          ) : (
            "Default setting (₵ 35.00 GHS)"
          )}
        </small>

        {toast && (
          <p
            className={toast.type === "success" ? "admin-fx-success" : "admin-fx-error"}
            role="status"
            style={{ margin: "4px 0 0" }}
          >
            {toast.message}
          </p>
        )}
      </div>
    </section>
  );
}
