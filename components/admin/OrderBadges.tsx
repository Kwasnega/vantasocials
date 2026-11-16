import Link from "next/link";
import type { OrderFailureReason } from "../../lib/fulfillment/failure-classifier";

/** Badge appearance for each failure reason */
export const FAILURE_REASON_BADGE: Record<OrderFailureReason, { label: string; color: string }> = {
  provider_insufficient_funds: { label: "Low Provider Balance", color: "#ff8c00" },
  provider_rejected:           { label: "Provider Rejected",    color: "#e53e3e" },
  invalid_target:              { label: "Bad Link/Target",       color: "#805ad5" },
  provider_timeout:            { label: "Timed Out",            color: "#d69e2e" },
  provider_unreachable:        { label: "Unreachable",          color: "#c05621" },
  internal_error:              { label: "Internal Error",       color: "#2b6cb0" },
  unknown:                     { label: "Unknown",              color: "#718096" },
};

/** Compact stage indicator mapping for quick visual lifecycle status */
export const FULFILLMENT_STAGE_CONFIG: Record<
  string,
  { label: string; step: number; total: number; color: string }
> = {
  NOT_STARTED: { label: "Created", step: 1, total: 5, color: "#6b7280" },
  SUBMITTING:  { label: "Submitting", step: 2, total: 5, color: "#eab308" },
  SUBMITTED:   { label: "Submitted", step: 3, total: 5, color: "#3b82f6" },
  PROCESSING:  { label: "In Progress", step: 4, total: 5, color: "#06b6d4" },
  COMPLETED:   { label: "Completed", step: 5, total: 5, color: "#22c55e" },
  PARTIAL:     { label: "Partial", step: 4, total: 5, color: "#a855f7" },
  FAILED:      { label: "Failed", step: 0, total: 5, color: "#ef4444" },
  CANCELLED:   { label: "Cancelled", step: 0, total: 5, color: "#9ca3af" },
};

export function OrderStageIndicator({ status }: { status: string }) {
  const stage = FULFILLMENT_STAGE_CONFIG[status] ?? {
    label: status,
    step: 0,
    total: 5,
    color: "#6b7280",
  };

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        fontSize: "11px",
        color: stage.color,
        fontWeight: 600,
      }}
    >
      <span
        style={{
          width: "7px",
          height: "7px",
          borderRadius: "50%",
          background: stage.color,
          boxShadow: `0 0 6px ${stage.color}88`,
          display: "inline-block",
        }}
      />
      <span>
        {stage.label}
        {stage.step > 0 && (
          <span style={{ fontSize: "10px", opacity: 0.7, marginLeft: "4px" }}>
            ({stage.step}/{stage.total})
          </span>
        )}
      </span>
    </div>
  );
}

export function FailureReasonBadge({ reason }: { reason: string }) {
  const badge = FAILURE_REASON_BADGE[reason as OrderFailureReason];
  if (!badge) return null;
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: "10px",
        fontWeight: 700,
        letterSpacing: "0.04em",
        padding: "2px 7px",
        borderRadius: "6px",
        background: badge.color + "22",
        color: badge.color,
        border: `1px solid ${badge.color}44`,
        marginTop: "3px",
        whiteSpace: "nowrap",
      }}
    >
      {badge.label}
    </span>
  );
}

export function FailureReasonChip({
  reason,
  count,
  active,
  href,
}: {
  reason: OrderFailureReason;
  count: number;
  active: boolean;
  href: string;
}) {
  const badge = FAILURE_REASON_BADGE[reason];
  return (
    <Link
      prefetch={false}
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        fontSize: "12px",
        fontWeight: active ? 800 : 600,
        padding: "4px 10px",
        borderRadius: "8px",
        background: active ? badge.color + "33" : "rgba(255,255,255,0.05)",
        color: active ? badge.color : "#aaa",
        border: `1px solid ${active ? badge.color + "66" : "rgba(255,255,255,0.1)"}`,
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: badge.color,
        }}
      />
      <span>
        {badge.label} ({count})
      </span>
    </Link>
  );
}
