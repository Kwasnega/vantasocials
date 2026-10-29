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
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== "object" || Array.isArray(body)) {
        const message = body && typeof body === "object" && "error" in body
          && typeof body.error === "string"
          ? body.error
          : "Unable to initialize payment.";
        throw new Error(message);
      }
      const result = body as Record<string, unknown>;
      if (
        typeof result.authorization_url !== "string"
        || !Array.isArray(result.allowed_checkout_hosts)
        || !result.allowed_checkout_hosts.every((host) => typeof host === "string")
      ) {
        throw new Error("Payment authorization could not be validated.");
      }
      let authorizationUrl: URL;
      try {
        authorizationUrl = new URL(result.authorization_url);
      } catch {
        throw new Error("Payment authorization could not be validated.");
      }
      if (
        authorizationUrl.protocol !== "https:"
        || authorizationUrl.username
        || authorizationUrl.password
        || authorizationUrl.hash
        || authorizationUrl.port
        || authorizationUrl.toString() !== result.authorization_url
        || !result.allowed_checkout_hosts.includes(authorizationUrl.hostname)
      ) {
        throw new Error("Payment authorization could not be validated.");
      }
      window.location.href = authorizationUrl.toString();
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
            <span>Preparing secure checkout…</span>
          </>
        ) : (
          <>
            <span className="checkout-btn-icon">🔒</span>
            <span>Pay {amountText ? amountText : "Now"} securely online</span>
          </>
        )}
      </button>
      {error && <p className="checkout-error-msg" role="alert">{error}</p>}
    </div>
  );
}
