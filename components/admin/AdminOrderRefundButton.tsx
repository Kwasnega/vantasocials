"use client";

import { useState } from "react";
import { AdminRefundModal } from "./AdminRefundModal";

export type AdminOrderRefundButtonProps = {
  orderId: string;
  publicOrderId: string;
  amount: number;
  currency: string;
  customerEmail?: string;
  eligible: boolean;
  requiresConfirmation: boolean;
  canRefund: boolean;
  reason?: string;
  refundStatus?: string | null;
  compact?: boolean;
};

export function AdminOrderRefundButton({
  orderId,
  publicOrderId,
  amount,
  currency,
  customerEmail,
  eligible,
  requiresConfirmation,
  canRefund,
  reason,
  refundStatus,
  compact = false,
}: AdminOrderRefundButtonProps) {
  const [modalOpen, setModalOpen] = useState(false);

  if (refundStatus === "REFUNDED") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: compact ? "2px 8px" : "6px 12px",
          borderRadius: "6px",
          fontSize: compact ? "11px" : "12px",
          fontWeight: 600,
          backgroundColor: "rgba(168, 85, 247, 0.15)",
          color: "#c084fc",
          border: "1px solid rgba(168, 85, 247, 0.3)",
        }}
      >
        ✓ Refunded
      </span>
    );
  }

  if (!canRefund) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        title={reason}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: compact ? "4px 10px" : "8px 14px",
          borderRadius: "6px",
          fontSize: compact ? "11px" : "12px",
          fontWeight: 600,
          backgroundColor: requiresConfirmation ? "rgba(217, 119, 6, 0.2)" : "rgba(99, 102, 241, 0.2)",
          color: requiresConfirmation ? "#fbbf24" : "#a5b4fc",
          border: requiresConfirmation ? "1px solid rgba(217, 119, 6, 0.4)" : "1px solid rgba(99, 102, 241, 0.4)",
          cursor: "pointer",
          whiteSpace: "nowrap",
          transition: "all 0.15s ease",
        }}
      >
        <span>↩</span>
        <span>{requiresConfirmation ? "Refund (Verify)" : "Refund to wallet"}</span>
      </button>

      <AdminRefundModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        orderId={orderId}
        publicOrderId={publicOrderId}
        amount={amount}
        currency={currency}
        customerEmail={customerEmail}
        isAmbiguous={requiresConfirmation}
        ambiguityReason={reason}
      />
    </>
  );
}
