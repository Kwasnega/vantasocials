"use client";

import { useState } from "react";

const CONFIRMATION_PHRASE = "WIPE ALL DATA";

type WipeCounts = {
  orders: number;
  payments: number;
  wallet_deposits: number;
  wallet_transactions: number;
  provider_orders: number;
  provider_events: number;
  fulfillment_claims: number;
  paystack_webhook_events: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWipeCounts(value: unknown): value is WipeCounts {
  return isRecord(value) && [
    "orders",
    "payments",
    "wallet_deposits",
    "wallet_transactions",
    "provider_orders",
    "provider_events",
    "fulfillment_claims",
    "paystack_webhook_events",
  ].every((key) => typeof value[key] === "number");
}

export function AdminDataWipe() {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removed, setRemoved] = useState<WipeCounts | null>(null);

  async function wipeData() {
    if (confirmation !== CONFIRMATION_PHRASE || busy) return;
    setBusy(true);
    setError("");
    setRemoved(null);

    try {
      const response = await fetch("/api/admin/data-wipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const message = isRecord(body) && typeof body.error === "string"
          ? body.error
          : "The data wipe could not be completed.";
        throw new Error(message);
      }

      const counts = isRecord(body) ? body.removed : null;
      if (!isWipeCounts(counts)) {
        throw new Error("The wipe result could not be confirmed. Please contact support before retrying.");
      }
      setRemoved(counts);
      setConfirmation("");
    } catch (wipeError) {
      setError(wipeError instanceof Error ? wipeError.message : "The data wipe could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-data-wipe" aria-labelledby="admin-data-wipe-title">
      <div className="admin-data-wipe-copy">
        <p className="dashboard-kicker">IRREVERSIBLE ACTION</p>
        <h2 id="admin-data-wipe-title">Wipe orders & financial data</h2>
        <p>
          Permanently removes all orders, payment and deposit records, wallet
          transaction history, provider fulfillment records, and Paystack
          webhook history. Customer wallet balances will be reset to zero.
        </p>
        <p className="admin-data-wipe-preserve">
          Services, platforms, provider mappings, pricing, customer accounts,
          and wallet accounts will stay intact.
        </p>
        <p className="admin-data-wipe-warning">
          This cannot be undone. Wipes are blocked while payments, deposits,
          payment notifications, or fulfillment are still in progress.
        </p>
      </div>

      <label className="admin-data-wipe-confirm">
        <span>Type <strong>{CONFIRMATION_PHRASE}</strong> to unlock the wipe button</span>
        <input
          autoComplete="off"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          aria-label={`Type ${CONFIRMATION_PHRASE} to confirm`}
          disabled={busy}
        />
      </label>
      <button
        className="admin-data-wipe-button"
        type="button"
        disabled={confirmation !== CONFIRMATION_PHRASE || busy}
        onClick={wipeData}
      >
        {busy ? "Wiping data…" : "Wipe all orders & financial data"}
      </button>

      {error && <p className="admin-data-wipe-error" role="alert">{error}</p>}
      {removed && (
        <div className="admin-data-wipe-success" role="status">
          <strong>Wipe completed.</strong>
          <span>
            Removed {removed.orders} orders, {removed.payments} payments,
            {` ${removed.wallet_deposits} deposits, ${removed.wallet_transactions} wallet entries, `}
            {`${removed.provider_orders} provider records, ${removed.provider_events} provider events, `}
            {`${removed.fulfillment_claims} fulfillment claims, and ${removed.paystack_webhook_events} Paystack webhook events.`}
          </span>
        </div>
      )}
    </section>
  );
}
