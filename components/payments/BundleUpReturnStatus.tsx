"use client";

import { useCallback, useEffect, useState } from "react";

type ReturnState =
  | "checking"
  | "confirmed"
  | "pending"
  | "unconfirmed"
  | "unresolved"
  | "retryable_error"
  | "unauthenticated"
  | "not_found";

export function BundleUpReturnStatus({ paymentId }: { paymentId: string }) {
  const [state, setState] = useState<ReturnState>("checking");
  const [retrying, setRetrying] = useState(false);

  const reconcile = useCallback(async () => {
    setRetrying(true);
    try {
      const response = await fetch("/api/payments/bundleup/reconcile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payment_id: paymentId }),
      });
      if (response.status === 401) {
        setState("unauthenticated");
        return;
      }
      if (response.status === 404) {
        setState("not_found");
        return;
      }
      if (!response.ok) {
        setState("retryable_error");
        return;
      }
      const result: unknown = await response.json();
      if (
        !result
        || typeof result !== "object"
        || !("status" in result)
        || typeof result.status !== "string"
      ) {
        setState("retryable_error");
        return;
      }
      if (result.status === "confirmed") {
        setState("confirmed");
      } else if (result.status === "pending") {
        setState("pending");
      } else if (result.status === "unconfirmed") {
        setState("unconfirmed");
      } else {
        setState("unresolved");
      }
    } catch {
      setState("retryable_error");
    } finally {
      setRetrying(false);
    }
  }, [paymentId]);

  useEffect(() => {
    void reconcile();
  }, [reconcile]);

  const message = {
    checking: "Checking payment status…",
    confirmed: "Payment confirmed by VANTA.",
    pending: "Payment is not confirmed yet. You can check again shortly.",
    unconfirmed: "Payment is not confirmed. No new payment has been started.",
    unresolved: "Payment status is still unresolved. You can safely retry the status check.",
    retryable_error: "We could not check payment status. Please retry.",
    unauthenticated: "Sign in to check this payment. The return link alone does not confirm payment.",
    not_found: "Payment attempt not found.",
  }[state];

  return (
    <>
      <p role="status" aria-live="polite">{message}</p>
      {state === "unauthenticated" ? (
        <a href="/login">Sign in</a>
      ) : state !== "confirmed" ? (
        <button type="button" onClick={() => void reconcile()} disabled={retrying}>
          {retrying ? "Checking…" : "Check payment status again"}
        </button>
      ) : null}
      <p>Payment confirmation is determined by VANTA’s server-side verification.</p>
    </>
  );
}
