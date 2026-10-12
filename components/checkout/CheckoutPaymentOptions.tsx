"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckoutPayButton } from "./CheckoutPayButton";

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

  const [method, setMethod] = useState<"wallet" | "paystack">(
    hasSufficientBalance ? "wallet" : "paystack"
  );
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
        {/* Wallet Method Card */}
        <label
          className={`checkout-method-card ${method === "wallet" ? "is-selected" : ""} ${!hasSufficientBalance ? "is-disabled-soft" : ""}`}
        >
          <input
            type="radio"
            name="checkout_method"
            value="wallet"
            checked={method === "wallet"}
            onChange={() => setMethod("wallet")}
          />
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
                <Link
                  href="/account/wallet"
                  className="checkout-topup-link"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Deposit Funds ↗
                </Link>
              </div>
            )}
          </div>
        </label>

        {/* Direct Payment (Paystack) Card */}
        <label className={`checkout-method-card ${method === "paystack" ? "is-selected" : ""}`}>
          <input
            type="radio"
            name="checkout_method"
            value="paystack"
            checked={method === "paystack"}
            onChange={() => setMethod("paystack")}
          />
          <div className="checkout-method-radio" aria-hidden="true" />
          <div className="checkout-method-content">
            <div className="checkout-method-header">
              <span className="checkout-method-title">Direct Payment (Paystack)</span>
              <span className="checkout-badges-strip">
                <span className="checkout-mini-pill">Cards</span>
                <span className="checkout-mini-pill">MoMo</span>
                <span className="checkout-mini-pill">Bank</span>
              </span>
            </div>
            <p className="checkout-method-desc">
              Secure online payment via Visa, Mastercard, Ghana Mobile Money (MTN, Telecel, AT), or Bank.
            </p>
          </div>
        </label>
      </div>

      {/* Action CTA depending on active method */}
      <div className="checkout-action-area">
        {method === "wallet" ? (
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
                Your wallet balance is insufficient for this order. Please deposit funds or choose Direct Payment above.
              </p>
            )}
          </div>
        ) : (
          <CheckoutPayButton orderId={orderId} amountText={`${totalAmount} ${currency}`} />
        )}

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
