"use client";

import { useState } from "react";

export function CheckoutPayButton({ orderId, amountText }: { orderId: string; amountText?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function initialize() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/payments/initialize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: orderId }),
      });
      const body = await response.json();
      if (!response.ok || typeof body.authorization_url !== "string") {
        throw new Error(body.error || "Unable to initialize payment.");
      }
      window.location.href = body.authorization_url;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to initialize payment.");
      setBusy(false);
    }
  }

  return (
    <div className="checkout-pay-action">
      <button
        type="button"
        className="checkout-btn checkout-btn-paystack"
        onClick={initialize}
        disabled={busy}
      >
        {busy ? (
          <>
            <span className="checkout-spinner" aria-hidden="true" />
            <span>Connecting to Paystack…</span>
          </>
        ) : (
          <>
            <span className="checkout-btn-icon">🔒</span>
            <span>Pay {amountText ? amountText : "Now"} via Paystack</span>
          </>
        )}
      </button>
      {error && <p className="checkout-error-msg" role="alert">{error}</p>}
    </div>
  );
}
