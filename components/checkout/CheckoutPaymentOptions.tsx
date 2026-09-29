"use client";

import { useState } from "react";
import { CheckoutPayButton } from "./CheckoutPayButton";

export function CheckoutPaymentOptions({ orderId, balanceMinor }: { orderId: string; balanceMinor: string }) {
  const [method, setMethod] = useState<"wallet" | "paystack">("wallet");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function payFromWallet() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/payments/wallet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order_id: orderId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to pay from wallet.");
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to pay from wallet.");
      setBusy(false);
    }
  }

  return <section>
    <label>Payment method <select value={method} onChange={(event) => setMethod(event.target.value as "wallet" | "paystack")}><option value="wallet">Wallet ({(Number(balanceMinor) / 100).toFixed(2)} GHS)</option><option value="paystack">Direct Paystack</option></select></label>
    {method === "wallet" ? <button type="button" onClick={payFromWallet} disabled={busy}>{busy ? "Paying from wallet…" : "Pay with wallet"}</button> : <CheckoutPayButton orderId={orderId} />}
    {error && <p role="alert">{error}</p>}
  </section>;
}
