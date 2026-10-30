"use client";
import { useRef, useState } from "react";

export default function WalletDepositForm() {
  const [amount, setAmount] = useState("35.00");
  const [state, setState] = useState("idle");
  const [message, setMessage] = useState("");
  const idempotencyKey = useRef(crypto.randomUUID());

  async function submit() {
    setState("loading");
    setMessage("");
    try {
      const response = await fetch("/api/account/wallet/deposit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify({ amount }),
      });
      const data = await response.json();
      if (data.reconciliation_required) {
        if (typeof data.reference === "string" && data.reference) {
          window.location.assign(`/account/wallet?deposit_reference=${encodeURIComponent(data.reference)}`);
          return;
        }
        setMessage(data.error || "We’re checking the payment setup. Please wait before trying again.");
        setState("error");
        return;
      }
      if (!response.ok) {
        if (data.retryable) idempotencyKey.current = crypto.randomUUID();
        throw new Error(data.error || "Unable to initialize deposit.");
      }
      if (typeof data.authorization_url !== "string") {
        throw new Error("Paystack did not return a checkout link. Please try again.");
      }
      setState("redirecting");
      window.location.assign(data.authorization_url);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Unable to initialize deposit.");
    }
  }

  return (
    <article className="dashboard-card wallet-deposit-card">
      <div className="wallet-deposit-heading">
        <span className="wallet-deposit-icon" aria-hidden="true">+</span>
        <div>
          <span>Deposit funds</span>
          <small>Add money to your VANTA wallet</small>
        </div>
      </div>
      <label className="wallet-amount-field">
        <span>GHS</span>
        <input
          aria-label="Deposit amount in GHS"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <small className="wallet-deposit-limits">Minimum GHS 35.00 <span aria-hidden="true">·</span> Maximum GHS 10,000.00</small>
      <button type="button" onClick={submit} disabled={state === "loading" || state === "redirecting"}>
        {state === "loading" ? "Starting…" : state === "redirecting" ? "Redirecting…" : "Deposit with Paystack"}
      </button>
      {message && <p role="alert">{message}</p>}
    </article>
  );
}
