"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CheckoutPaymentOptions({
  orderId,
  balanceMinor,
  totalAmount,
  currency = "GHS",
}: {
  orderId: string;
  balanceMinor: string;
  totalAmount: string;
  currency?: string;
}) {
  const router = useRouter();
  const balanceMajor = Number(balanceMinor || 0) / 100;
  const totalMajor = Number(totalAmount || 0);
  const hasSufficientBalance = balanceMajor >= totalMajor && totalMajor > 0;
  const deficit = Math.max(0, totalMajor - balanceMajor);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function payFromWallet() {
    setBusy(true);
    setError("");
    let paymentWasRejected = false;
    try {
      const response = await fetch("/api/payments/wallet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: orderId }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (response.status >= 500) {
          throw new Error("We couldn’t confirm the payment result. Check your order status before trying again.");
        }
        paymentWasRejected = true;
        throw new Error(body.error || "Unable to pay from wallet.");
      }

      const confirmedOrder = body.order ?? body;
      if (confirmedOrder.public_order_id !== orderId || confirmedOrder.payment_status !== "PAID") {
        throw new Error("We couldn’t confirm the payment result. Check your order status before trying again.");
      }
      router.push(`/account/orders/${encodeURIComponent(confirmedOrder.public_order_id)}`);
    } catch (cause) {
      setError(paymentWasRejected && cause instanceof Error
        ? cause.message
        : "We couldn’t confirm the payment result. Check your order status before trying again.");
      setBusy(false);
    }
  }

  return (
    <div className="checkout-payment-box">
      <div className="checkout-payment-methods">
        <div className={`checkout-method-card is-selected ${!hasSufficientBalance ? "is-disabled-soft" : ""}`}>
          <div className="checkout-method-radio" aria-hidden="true" />
          <div className="checkout-method-content">
            <div className="checkout-method-header">
              <span className="checkout-method-title">VANTA Wallet</span>
              <span className={`checkout-balance-badge ${hasSufficientBalance ? "has-funds" : "low-funds"}`}>
                Balance: {balanceMajor.toFixed(2)} {currency}
              </span>
            </div>
            <p className="checkout-method-desc">
              Instant 1-click deduction from your account balance.
            </p>
            {!hasSufficientBalance && (
              <div className="checkout-insufficient-hint">
                <span>⚠️ Short by {deficit.toFixed(2)} {currency}</span>
                <Link href="/account/wallet" className="checkout-topup-link">Add funds to wallet ↗</Link>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="checkout-action-area">
        <div>
          <button
            type="button"
            className="checkout-btn checkout-btn-wallet"
            onClick={payFromWallet}
            disabled={busy || !hasSufficientBalance}
          >
            {busy ? (
              <>
                <span className="checkout-spinner" aria-hidden="true" />
                <span>Processing wallet payment…</span>
              </>
            ) : (
              <>
                <span className="checkout-btn-icon">⚡</span>
                <span>Pay {totalAmount} {currency} from Wallet</span>
              </>
            )}
          </button>
          {!hasSufficientBalance && (
            <p className="checkout-field-warning">
              Your wallet balance is insufficient. Add funds to your VANTA Wallet, then return here to pay.
            </p>
          )}
        </div>

        {error && (
          <div className="checkout-error-banner" role="alert">
            <span>✕</span>
            <p>{error}</p>
          </div>
        )}
      </div>

      <div className="checkout-trust-footer">
        <span>🔒 256-bit Bank-grade Encryption</span>
        <span>•</span>
        <span>Guaranteed Fulfillment</span>
        <span>•</span>
        <span>No Social Password Ever Needed</span>
      </div>
    </div>
  );
}
