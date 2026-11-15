"use client";
import { useEffect, useRef, useState } from "react";

type DepositLimits = {
  minDepositGhs: number;
  maxDepositGhs: number;
  formattedMin: string;
  formattedMax: string;
};

const DEFAULT_LIMITS: DepositLimits = {
  minDepositGhs: 35.0,
  maxDepositGhs: 10000.0,
  formattedMin: "35.00",
  formattedMax: "10,000.00",
};

export default function WalletDepositForm() {
  const [limits, setLimits] = useState<DepositLimits>(DEFAULT_LIMITS);
  const [amount, setAmount] = useState(DEFAULT_LIMITS.formattedMin);
  const [hasEdited, setHasEdited] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "redirecting" | "error">("idle");
  const [message, setMessage] = useState("");
  const idempotencyKey = useRef(crypto.randomUUID());

  // Fetch live deposit limits with short client cache
  useEffect(() => {
    let active = true;
    async function loadLimits() {
      try {
        const res = await fetch("/api/settings/deposit-limits");
        if (!res.ok) return;
        const data = await res.json();
        if (active && data && typeof data.minDepositGhs === "number") {
          const loaded: DepositLimits = {
            minDepositGhs: data.minDepositGhs,
            maxDepositGhs: data.maxDepositGhs ?? 10000.0,
            formattedMin: data.formattedMin ?? data.minDepositGhs.toFixed(2),
            formattedMax: data.formattedMax ?? "10,000.00",
          };
          setLimits(loaded);
          // Set initial amount only if user hasn't started typing
          setAmount((prev) => {
            if (!hasEdited || prev === DEFAULT_LIMITS.formattedMin) {
              return loaded.formattedMin;
            }
            return prev;
          });
        }
      } catch {
        // Safe fallback already in state
      }
    }
    loadLimits();
    return () => {
      active = false;
    };
  }, [hasEdited]);

  const numAmount = Number(amount.trim());
  const isValidAmount =
    /^\d+(\.\d{1,2})?$/.test(amount.trim()) &&
    Number.isFinite(numAmount) &&
    numAmount >= limits.minDepositGhs &&
    numAmount <= limits.maxDepositGhs;

  const isBelowMin =
    /^\d+(\.\d{1,2})?$/.test(amount.trim()) &&
    Number.isFinite(numAmount) &&
    numAmount > 0 &&
    numAmount < limits.minDepositGhs;

  async function submit() {
    if (!isValidAmount) return;
    setState("loading");
    setMessage("");
    try {
      const response = await fetch("/api/account/wallet/deposit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify({ amount: amount.trim() }),
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
          onChange={(event) => {
            setHasEdited(true);
            setAmount(event.target.value);
            if (message) setMessage("");
          }}
        />
      </label>
      <small className="wallet-deposit-limits">
        Minimum GHS {limits.formattedMin} <span aria-hidden="true">·</span> Maximum GHS {limits.formattedMax}
      </small>
      {isBelowMin && (
        <small style={{ color: "#ff8c94", fontSize: "12px", display: "block", marginTop: "4px" }}>
          Amount is below the minimum deposit of GHS {limits.formattedMin}.
        </small>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={state === "loading" || state === "redirecting" || !isValidAmount}
      >
        {state === "loading" ? "Starting…" : state === "redirecting" ? "Redirecting…" : "Deposit with Paystack"}
      </button>
      {message && <p role="alert">{message}</p>}
    </article>
  );
}
