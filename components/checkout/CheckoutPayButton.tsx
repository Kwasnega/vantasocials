"use client";

import { useState } from "react";

export function CheckoutPayButton({ orderId }: { orderId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function initialize() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/payments/initialize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order_id: orderId }) });
      const body = await response.json();
      if (!response.ok || typeof body.authorization_url !== "string") throw new Error(body.error || "Unable to initialize payment.");
      window.location.href = body.authorization_url;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to initialize payment."); setBusy(false); }
  }
  return <><button type="button" onClick={initialize} disabled={busy}>{busy ? "Starting payment…" : "Pay now"}</button>{error && <p role="alert">{error}</p>}</>;
}
