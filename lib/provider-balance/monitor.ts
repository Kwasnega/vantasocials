import "server-only";
import { createSupabaseAdminClient } from "../supabase/server";
import { ReliableSMMReadOnlyClient } from "../fulfillment/reliablesmm/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BalanceAlertStatus = "OK" | "WARNING" | "CRITICAL" | "UNKNOWN";

export interface BalanceThresholds {
  warning: number;   // USD – alert transitions to WARNING below this
  critical: number;  // USD – alert transitions to CRITICAL below this
  serviceBlockOnCritical: boolean; // feature flag (default OFF)
}

export interface BalanceMonitorResult {
  status: "ok" | "api_error" | "db_error";
  balance: number | null;
  currency: string | null;
  alertStatus: BalanceAlertStatus;
  runwayDays: number | null;
  consecutiveFailures: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Defaults (used when app_settings row is missing)
// ---------------------------------------------------------------------------

const DEFAULT_WARNING_THRESHOLD = 10.0;
const DEFAULT_CRITICAL_THRESHOLD = 3.0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read balance monitoring thresholds + block flag from app_settings.
 * Resilient: falls back to defaults on any error so the monitor never crashes.
 */
export async function getBalanceThresholds(): Promise<BalanceThresholds> {
  const db = createSupabaseAdminClient();
  try {
    const { data, error } = await db
      .from("app_settings")
      .select("key,value")
      .in("key", [
        "reliablesmm_balance_warning_threshold",
        "reliablesmm_balance_critical_threshold",
        "reliablesmm_service_block_on_critical",
      ]);

    if (error || !data) {
      console.warn("[getBalanceThresholds] DB error, using defaults:", error?.message);
      return {
        warning: DEFAULT_WARNING_THRESHOLD,
        critical: DEFAULT_CRITICAL_THRESHOLD,
        serviceBlockOnCritical: false,
      };
    }

    const byKey = Object.fromEntries(data.map((r) => [r.key, r.value]));

    const warning = Number(byKey["reliablesmm_balance_warning_threshold"] ?? DEFAULT_WARNING_THRESHOLD);
    const critical = Number(byKey["reliablesmm_balance_critical_threshold"] ?? DEFAULT_CRITICAL_THRESHOLD);
    const blockRaw = byKey["reliablesmm_service_block_on_critical"];
    const serviceBlockOnCritical =
      blockRaw === true || blockRaw === "true" || blockRaw === 1;

    return {
      warning: Number.isFinite(warning) && warning > 0 ? warning : DEFAULT_WARNING_THRESHOLD,
      critical: Number.isFinite(critical) && critical >= 0 ? critical : DEFAULT_CRITICAL_THRESHOLD,
      serviceBlockOnCritical,
    };
  } catch (err) {
    console.warn("[getBalanceThresholds] Exception, using defaults:", err instanceof Error ? err.message : err);
    return {
      warning: DEFAULT_WARNING_THRESHOLD,
      critical: DEFAULT_CRITICAL_THRESHOLD,
      serviceBlockOnCritical: false,
    };
  }
}

/**
 * Compute alert status from a numeric balance and thresholds.
 * Pure function – testable without DB.
 */
export function computeBalanceAlertStatus(
  balance: number,
  warning: number,
  critical: number
): BalanceAlertStatus {
  if (balance < critical) return "CRITICAL";
  if (balance < warning) return "WARNING";
  return "OK";
}

/**
 * Estimate how many days the current balance will last based on the
 * average daily spend from provider_orders over the past 7 days.
 * Returns null if there's not enough data or on any error.
 */
export async function computeRunwayDays(
  currentBalance: number
): Promise<number | null> {
  const db = createSupabaseAdminClient();
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await db
      .from("provider_orders")
      .select("charge")
      .eq("provider", "reliablesmm")
      .gte("created_at", since)
      .not("charge", "is", null);

    if (error || !data || data.length === 0) return null;

    const totalSpend = data.reduce((sum, r) => sum + Number(r.charge ?? 0), 0);
    if (totalSpend <= 0) return null;

    const avgDailySpend = totalSpend / 7;
    const days = currentBalance / avgDailySpend;
    return Math.max(0, Math.round(days * 10) / 10); // round to 1 dp
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main monitor function
// ---------------------------------------------------------------------------

/**
 * Run one balance-monitoring cycle:
 *  1. Fetch current balance from ReliableSMM API
 *  2. Compare to thresholds from app_settings
 *  3. Upsert provider_health with updated alert status + failure tracking
 *
 * Three consecutive API failures → conservative CRITICAL (never leave unknown
 * when the API is unreachable, since the balance may be truly exhausted).
 */
export async function runBalanceMonitor(): Promise<BalanceMonitorResult> {
  const db = createSupabaseAdminClient();
  const now = new Date().toISOString();

  // Read existing failure count so we can increment on failure
  let currentFailures = 0;
  try {
    const { data: existing } = await db
      .from("provider_health")
      .select("consecutive_check_failures")
      .eq("provider", "reliablesmm")
      .maybeSingle();
    currentFailures = Number(existing?.consecutive_check_failures ?? 0);
  } catch {
    // best-effort
  }

  // 1. Fetch API balance
  let balance: number | null = null;
  let currency: string | null = null;
  let apiError: string | null = null;

  try {
    const result = await new ReliableSMMReadOnlyClient().getBalance();
    balance = Number(result.balance);
    currency = result.currency;
  } catch (err) {
    apiError = err instanceof Error ? err.message : "Balance fetch failed";
    console.error("[runBalanceMonitor] API error:", apiError);
  }

  // 2. Handle API failure
  if (apiError !== null || balance === null || !Number.isFinite(balance)) {
    const newFailures = currentFailures + 1;
    // 3+ consecutive failures → conservative CRITICAL
    const alertStatus: BalanceAlertStatus = newFailures >= 3 ? "CRITICAL" : "UNKNOWN";

    try {
      await db.from("provider_health").upsert({
        provider: "reliablesmm",
        configured: Boolean(process.env.RELIABLESMM_API_KEY),
        last_balance_check: now,
        balance_status: "FAILED",
        last_error: apiError ?? "null balance returned",
        balance_alert_status: alertStatus,
        consecutive_check_failures: newFailures,
        updated_at: now,
      });
    } catch (dbErr) {
      console.error("[runBalanceMonitor] DB upsert error after API failure:", dbErr);
      return {
        status: "db_error",
        balance: null,
        currency: null,
        alertStatus,
        runwayDays: null,
        consecutiveFailures: newFailures,
        error: "DB upsert failed after API error",
      };
    }

    return {
      status: "api_error",
      balance: null,
      currency: null,
      alertStatus,
      runwayDays: null,
      consecutiveFailures: newFailures,
      error: apiError ?? "null balance",
    };
  }

  // 3. Balance retrieved successfully — compute alert status
  const { warning, critical } = await getBalanceThresholds();
  const alertStatus = computeBalanceAlertStatus(balance, warning, critical);
  const runwayDays = await computeRunwayDays(balance);

  try {
    await db.from("provider_health").upsert({
      provider: "reliablesmm",
      configured: true,
      balance: String(balance),
      balance_currency: currency ?? "USD",
      last_balance_check: now,
      balance_status: "SUCCEEDED",
      last_error: null,
      balance_alert_status: alertStatus,
      consecutive_check_failures: 0, // reset on success
      updated_at: now,
    });
  } catch (dbErr) {
    console.error("[runBalanceMonitor] DB upsert error after successful fetch:", dbErr);
    return {
      status: "db_error",
      balance,
      currency,
      alertStatus,
      runwayDays,
      consecutiveFailures: 0,
      error: "DB upsert failed",
    };
  }

  return {
    status: "ok",
    balance,
    currency,
    alertStatus,
    runwayDays,
    consecutiveFailures: 0,
  };
}
