"use client";

import { FormEvent, useState } from "react";

type PasswordChangeResponse = { error?: string; updated?: boolean };

export function PasswordChangeForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (newPassword.length < 6) {
      setError("Your new password must contain at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Your new passwords do not match.");
      return;
    }
    if (currentPassword === newPassword) {
      setError("Choose a new password that differs from your current password.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result = await response.json().catch(() => null) as PasswordChangeResponse | null;
      if (!response.ok) {
        setError(
          result && typeof result.error === "string"
            ? result.error
            : "Your password could not be changed. Please try again.",
        );
        return;
      }
      if (!result?.updated) {
        setError("The password change could not be confirmed. Please try again.");
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("Your password has been changed successfully.");
    } catch {
      setError("We couldn't reach VANTA to change your password. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="password-change-form" onSubmit={submit}>
      <div className="password-change-heading">
        <span className="password-change-mark" aria-hidden="true">↗</span>
        <div>
          <h3>Change password</h3>
          <p>Confirm your current password to set a new one.</p>
        </div>
      </div>
      <label>
        Current password
        <input
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      <div className="password-change-fields">
        <label>
          New password
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            minLength={6}
            required
          />
        </label>
        <label>
          Confirm new password
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            minLength={6}
            required
          />
        </label>
      </div>
      <p className="password-change-hint">Use at least 6 characters.</p>
      {error && <p className="password-change-feedback is-error" role="alert">{error}</p>}
      {message && <p className="password-change-feedback is-success" role="status">{message}</p>}
      <button className="password-change-submit" type="submit" disabled={saving}>
        {saving ? "Updating password…" : "Update password"}
        {!saving && <span aria-hidden="true">→</span>}
      </button>
    </form>
  );
}
