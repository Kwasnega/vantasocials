"use client";

import { useState } from "react";
import { AdminBulkRefundModal } from "./AdminBulkRefundModal";

export type AdminBulkRefundActionProps = {
  eligibleOrders: Array<{
    id: string;
    publicOrderId: string;
    amount: number;
    currency: string;
  }>;
};

export function AdminBulkRefundAction({ eligibleOrders }: AdminBulkRefundActionProps) {
  const [modalOpen, setModalOpen] = useState(false);

  if (!eligibleOrders || eligibleOrders.length === 0) {
    return null;
  }

  const totalAmount = eligibleOrders.reduce((sum, o) => sum + (o.amount || 0), 0);

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 14px",
          borderRadius: "8px",
          fontSize: "13px",
          fontWeight: 600,
          backgroundColor: "rgba(168, 85, 247, 0.2)",
          color: "#c084fc",
          border: "1px solid rgba(168, 85, 247, 0.4)",
          cursor: "pointer",
          whiteSpace: "nowrap",
          transition: "all 0.15s ease",
        }}
      >
        <span>↩</span>
        <span>Bulk Refund ({eligibleOrders.length}) — GHS {totalAmount.toFixed(2)}</span>
      </button>

      <AdminBulkRefundModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        eligibleOrders={eligibleOrders}
      />
    </>
  );
}
