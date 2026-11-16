"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function WalletDepositStatus({
  reference,
  returnTo,
  hasPendingDeposits,
  initialHealCount = 0,
  initialHealTotalGhs = "0.00",
}: {
  reference?: string;
  returnTo?: string;
  hasPendingDeposits?: boolean;
  initialHealCount?: number;
  initialHealTotalGhs?: string;
}) {
  const router = useRouter();

  // If initial load already healed a deposit, show success message immediately
  const [message, setMessage] = useState<string>(() => {
    if (initialHealCount > 0) {
      return `We found your GHS ${initialHealTotalGhs} payment and added it to your wallet.`;
    }
    if (reference) return "Verifying your deposit…";
    if (hasPendingDeposits) return "You have an unconfirmed payment pending. Confirming payment…";
    return "";
  });

  const [checking, setChecking] = useState(false);
  const [isSuccess, setIsSuccess] = useState(initialHealCount > 0);

  async function verify(refToVerify?: string) {
    const targetRef = refToVerify || reference;
    setChecking(true);

    if (targetRef) {
      try {
        const response = await fetch("/api/account/wallet/deposit/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reference: targetRef }),
        });
        const data = await response.json();
        if (data.status === "PAID") {
          setIsSuccess(true);
          router.refresh();
          if (returnTo) {
            setTimeout(() => {
              window.location.assign(returnTo);
            }, 1500);
          }
        }
        setMessage(
          data.status === "PAID"
            ? returnTo
              ? "Deposit successful! Returning to your order in a moment…"
              : "Deposit successful. Your balance is updated."
            : data.status === "PENDING"
            ? "Payment is still processing on Paystack. You can confirm again safely."
            : data.error || "Deposit could not be verified."
        );
      } catch {
        setMessage("Deposit verification is temporarily unavailable.");
      } finally {
        setChecking(false);
      }
    } else {
      // General self-heal for all recent pending deposits
      try {
        const response = await fetch("/api/account/wallet/deposit/settle", {
          method: "POST",
        });
        const data = await response.json();
        if (data.creditedCount > 0) {
          setIsSuccess(true);
          const ghs = (Number(data.totalCreditedMinor || 0) / 100).toFixed(2);
          setMessage(`We found your GHS ${ghs} payment and added it to your wallet.`);
          router.refresh();
        } else {
          setMessage("No new completed payments found. If you completed payment, click Confirm in a few moments.");
        }
      } catch {
        setMessage("Deposit check is temporarily unavailable.");
      } finally {
        setChecking(false);
      }
    }
  }

  useEffect(() => {
    if (reference) {
      void verify(reference);
    } else if (hasPendingDeposits && initialHealCount === 0) {
      // Auto-trigger confirmation check when visiting with pending deposits
      void verify();
    }
  }, [reference, hasPendingDeposits]);

  if (!message) return null;

  return (
    <div
      className="dashboard-card"
      role="status"
      style={{
        marginBottom: "20px",
        padding: "16px",
        borderColor: isSuccess ? "rgba(16, 185, 129, 0.4)" : hasPendingDeposits ? "rgba(245, 158, 11, 0.4)" : undefined,
        backgroundColor: isSuccess ? "rgba(16, 185, 129, 0.1)" : hasPendingDeposits ? "rgba(245, 158, 11, 0.08)" : undefined,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
        <p style={{ margin: 0, fontWeight: isSuccess ? 600 : 400, color: isSuccess ? "#34d399" : hasPendingDeposits ? "#fbbf24" : "#fff" }}>
          {checking ? "Confirming payment…" : message}
        </p>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {isSuccess && returnTo && (
            <a
              href={returnTo}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                backgroundColor: "#10b981",
                color: "#000",
                fontWeight: 600,
                fontSize: "12px",
                textDecoration: "none",
              }}
            >
              Return to order now →
            </a>
          )}
          {!isSuccess && (
            <button
              type="button"
              onClick={() => void verify()}
              disabled={checking}
              style={{
                padding: "6px 14px",
                borderRadius: "6px",
                backgroundColor: hasPendingDeposits ? "#f59e0b" : "rgba(255,255,255,0.1)",
                color: hasPendingDeposits ? "#000" : "#fff",
                fontWeight: hasPendingDeposits ? 600 : 400,
                border: "none",
                fontSize: "12px",
                cursor: checking ? "not-allowed" : "pointer",
              }}
            >
              {checking ? "Confirming…" : "Confirm payment"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
