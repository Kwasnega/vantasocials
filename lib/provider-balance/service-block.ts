import "server-only";
import { createSupabaseAdminClient } from "../supabase/server";
import { getBalanceThresholds } from "../provider-balance/monitor";

export interface ServiceBlockStatus {
  /** true when the service-block feature flag is ON AND balance is CRITICAL */
  blocked: boolean;
  /** Customer-facing message (only set when blocked === true) */
  message: string | null;
}

/**
 * Returns whether a service should be blocked due to a critically
 * low provider balance, subject to the `reliablesmm_service_block_on_critical`
 * feature flag being enabled in app_settings.
 *
 * Can receive either the provider name ("reliablesmm") or the service ID.
 * If service ID is given, checks if that service's provider is "reliablesmm".
 * If no provider/serviceId is passed, checks the global reliablesmm state.
 *
 * Always resolves — never throws. Falls back to { blocked: false } on any error
 * so this never disrupts the customer experience.
 */
export async function getServiceBlockStatus(options?: {
  provider?: string | null;
  serviceId?: string | null;
}): Promise<ServiceBlockStatus> {
  try {
    const db = createSupabaseAdminClient();

    // Check if provider is specified or needs resolving via serviceId
    if (options?.serviceId && !options?.provider) {
      const { data: svc } = await db
        .from("services")
        .select("provider")
        .eq("id", options.serviceId)
        .maybeSingle();
      if (svc && svc.provider !== "reliablesmm") {
        return { blocked: false, message: null };
      }
    } else if (options?.provider && options.provider !== "reliablesmm") {
      return { blocked: false, message: null };
    }

    const [{ serviceBlockOnCritical }, healthResult] = await Promise.all([
      getBalanceThresholds(),
      db
        .from("provider_health")
        .select("balance_alert_status")
        .eq("provider", "reliablesmm")
        .maybeSingle(),
    ]);

    if (!serviceBlockOnCritical) return { blocked: false, message: null };

    const alertStatus = healthResult.data?.balance_alert_status;
    if (alertStatus === "CRITICAL") {
      return {
        blocked: true,
        message: "This service is temporarily unavailable. Please try again later.",
      };
    }

    return { blocked: false, message: null };
  } catch {
    // Never block due to our own error
    return { blocked: false, message: null };
  }
}
