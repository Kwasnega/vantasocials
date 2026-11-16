"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function WalletDepositStatus({
  reference,
  returnTo,
}: {
  reference?: string;
  returnTo?: string;
}) {
  const [message, setMessage] = useState(reference ? "Verifying your deposit…" : "");
  const [checking, setChecking] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const router = useRouter();

  async function verify() {
    if (!reference) return;
    setChecking(true);
    try {
      const response = await fetch("/api/account/wallet/deposit/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reference }),
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
          ? "Payment is still processing. You can check again safely."
          : data.error || "Deposit could not be verified."
      );
    } catch {
      setMessage("Deposit verification is temporarily unavailable.");
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    void verify();
  }, [reference]);

  if (!message) return null;

  return (
    <div
      className="dashboard-card"
      role="status"
      style={{
        marginBottom: "20px",
        padding: "16px",
        borderColor: isSuccess ? "rgba(16, 185, 129, 0.4)" : undefined,
        backgroundColor: isSuccess ? "rgba(16, 185, 129, 0.1)" : undefined,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
        <p style={{ margin: 0, fontWeight: isSuccess ? 600 : 400, color: isSuccess ? "#34d399" : "#fff" }}>
          {message}
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
          {reference && !isSuccess && (
            <button
              type="button"
              onClick={() => void verify()}
              disabled={checking}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                backgroundColor: "rgba(255,255,255,0.1)",
                color: "#fff",
                border: "none",
                fontSize: "12px",
                cursor: checking ? "not-allowed" : "pointer",
              }}
            >
              {checking ? "Checking…" : "Check status again"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
