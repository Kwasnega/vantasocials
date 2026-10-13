"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";

export function DeleteAccountButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function deleteAccount() {
    const confirmed = window.confirm(
      "Are you sure you want to delete your account? This permanently disables sign-in. Order and financial records will be retained.",
    );
    if (!confirmed) return;

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Your account could not be deleted.");

      const { error: signOutError } = await createSupabaseBrowserClient().auth.signOut({ scope: "global" });
      if (signOutError) {
        window.location.replace("/login?account=deleted");
        return;
      }
      window.location.replace("/login?account=deleted");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your account could not be deleted.");
      setBusy(false);
    }
  }

  return (
    <div className="account-delete-action">
      <button type="button" className="account-delete-button" onClick={() => void deleteAccount()} disabled={busy}>
        {busy ? "Deleting account…" : "Delete my account"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
