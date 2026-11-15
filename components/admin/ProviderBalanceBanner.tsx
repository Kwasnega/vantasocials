import "server-only";
import Link from "next/link";
import { createSupabaseAdminClient } from "../../lib/supabase/server";
import type { BalanceAlertStatus } from "../../lib/provider-balance/monitor";

/**
 * ProviderBalanceBanner — server component injected into the admin layout.
 *
 * Shows a persistent banner when provider balance alert status is WARNING or CRITICAL.
 * Includes count of orders awaiting retry due to insufficient funds.
 * Never exposes the actual balance amount in the banner (admin dashboard shows that).
 */
export async function ProviderBalanceBanner() {
  try {
    const db = createSupabaseAdminClient();

    const [healthResult, insufficientResult] = await Promise.all([
      db
        .from("provider_health")
        .select("balance_alert_status, balance, balance_currency, last_balance_check")
        .eq("provider", "reliablesmm")
        .maybeSingle(),
      db
        .from("orders")
        .select("id", { count: "planned", head: true })
        .eq("fulfillment_status", "FAILED")
        .eq("failure_reason", "provider_insufficient_funds"),
    ]);

    const health = healthResult.data;
    const alertStatus = (health?.balance_alert_status ?? "UNKNOWN") as BalanceAlertStatus;

    // Only show banner for WARNING or CRITICAL
    if (alertStatus !== "WARNING" && alertStatus !== "CRITICAL") return null;

    const insufficientCount = insufficientResult.count ?? 0;
    const isCritical = alertStatus === "CRITICAL";

    const bannerStyle: React.CSSProperties = {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "10px 20px",
      background: isCritical ? "#2d1a1a" : "#2a2010",
      borderBottom: `2px solid ${isCritical ? "#e53e3e" : "#d69e2e"}`,
      fontSize: 13,
      color: isCritical ? "#fc8181" : "#f6e05e",
      fontWeight: 500,
      flexWrap: "wrap" as const,
    };

    const dotStyle: React.CSSProperties = {
      width: 8,
      height: 8,
      borderRadius: "50%",
      background: isCritical ? "#e53e3e" : "#d69e2e",
      flexShrink: 0,
    };

    return (
      <div style={bannerStyle} role="alert" aria-live="polite">
        <span style={dotStyle} aria-hidden="true" />
        <span>
          <strong>Provider balance {isCritical ? "CRITICAL" : "WARNING"}.</strong>{" "}
          {isCritical
            ? "Provider balance is critically low. Services may be unable to fulfil orders."
            : "Provider balance is running low. Monitor the dashboard closely."}
          {insufficientCount > 0 && (
            <>
              {" "}
              <strong>{insufficientCount}</strong> order{insufficientCount !== 1 ? "s" : ""} awaiting
              retry due to insufficient provider funds.
            </>
          )}
        </span>
        {insufficientCount > 0 && (
          <Link
            href="/admin/orders?failure_reason=provider_insufficient_funds&fulfillment=FAILED"
            prefetch={false}
            style={{
              marginLeft: "auto",
              color: isCritical ? "#fc8181" : "#f6e05e",
              textDecoration: "underline",
              whiteSpace: "nowrap",
              fontWeight: 700,
            }}
          >
            Retry {insufficientCount} order{insufficientCount !== 1 ? "s" : ""} →
          </Link>
        )}
      </div>
    );
  } catch {
    // Banner errors must never break the admin layout
    return null;
  }
}
