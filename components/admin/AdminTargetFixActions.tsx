"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { AdminTargetFixModal } from "./AdminTargetFixModal";

interface AdminTargetFixActionsProps {
  orderId: string;
  publicOrderId: string;
  currentTarget: string;
  targetType: string;
  platformSlug: string;
  failureReason: string | null;
  fulfillmentStatus: string;
  targetFixStatus: string | null;
}

export function AdminTargetFixActions({
  orderId,
  publicOrderId,
  currentTarget,
  targetType,
  platformSlug,
  failureReason,
  fulfillmentStatus,
  targetFixStatus,
}: AdminTargetFixActionsProps) {
  const router = useRouter();
  const [showEditModal, setShowEditModal] = useState(false);
  const [askingFix, setAskingFix] = useState(false);
  const [askStatus, setAskStatus] = useState<string | null>(null);

  // Only show actions if failed due to invalid_target
  if (failureReason !== "invalid_target" || fulfillmentStatus !== "FAILED") {
    return null;
  }

  async function handleAskCustomerFix() {
    setAskingFix(true);
    setAskStatus(null);

    try {
      const res = await fetch(`/api/admin/orders/${orderId}/ask-fix`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setAskStatus("✓ Emailed customer");
        router.refresh();
      } else {
        setAskStatus(`Error: ${data.error || "Failed to send fix link"}`);
      }
    } catch {
      setAskStatus("Error: Network failure");
    } finally {
      setAskingFix(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mt-2">
      <button
        type="button"
        onClick={() => setShowEditModal(true)}
        className="rounded bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 text-xs font-semibold transition-colors min-h-[36px]"
      >
        ✏️ Edit target & retry
      </button>

      <button
        type="button"
        onClick={handleAskCustomerFix}
        disabled={askingFix || targetFixStatus === "AWAITING_CUSTOMER"}
        className="rounded border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 disabled:opacity-50 px-3 py-1.5 text-xs font-semibold transition-colors min-h-[36px]"
      >
        {askingFix
          ? "Sending..."
          : targetFixStatus === "AWAITING_CUSTOMER"
          ? "Fix link sent (Awaiting)"
          : "✉️ Ask customer to fix"}
      </button>

      {askStatus && (
        <span className={`text-xs ${askStatus.startsWith("✓") ? "text-emerald-400" : "text-red-400"}`}>
          {askStatus}
        </span>
      )}

      {showEditModal && (
        <AdminTargetFixModal
          orderId={orderId}
          publicOrderId={publicOrderId}
          currentTarget={currentTarget}
          targetType={targetType}
          platformSlug={platformSlug}
          onSuccess={() => {
            setShowEditModal(false);
            router.refresh();
          }}
          onClose={() => setShowEditModal(false)}
        />
      )}
    </div>
  );
}
