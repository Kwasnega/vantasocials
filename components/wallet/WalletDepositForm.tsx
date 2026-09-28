"use client";
import { useState } from "react";

export default function WalletDepositForm() {
  const [amount, setAmount] = useState("10.00"); const [state, setState] = useState("idle"); const [message, setMessage] = useState(""); const [idempotencyKey] = useState(() => crypto.randomUUID());
  async function submit() { setState("loading"); setMessage(""); try { const response = await fetch("/api/account/wallet/deposit", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ amount }) }); const data = await response.json(); if (data.reconciliation_required && data.reference) { window.location.assign(`/account/wallet?deposit_reference=${encodeURIComponent(data.reference)}`); return; } if (!response.ok) throw new Error(data.error || "Unable to initialize deposit."); setState("redirecting"); window.location.assign(data.authorization_url); } catch (error) { setState("error"); setMessage(error instanceof Error ? error.message : "Unable to initialize deposit."); } }
  return <article className="dashboard-card"><span>Deposit funds</span><input aria-label="Deposit amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /><small>GHS 1.00 minimum · GHS 10,000.00 maximum</small><button type="button" onClick={submit} disabled={state === "loading" || state === "redirecting"}>{state === "loading" ? "Starting…" : state === "redirecting" ? "Redirecting…" : "Deposit with Paystack"}</button>{message && <p role="alert">{message}</p>}</article>;
}
