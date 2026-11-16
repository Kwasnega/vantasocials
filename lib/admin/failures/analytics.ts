import "server-only";
import { unstable_cache } from "next/cache";
import { createSupabaseAdminClient } from "../../supabase/server";
import {
  type FailureReasonItem,
  type FailurePlatformItem,
  type FailureServiceItem,
  type FailureSpikeItem,
  type FailureAnalyticsData,
  evaluateServiceSpike,
} from "./types";

export * from "./types";

/**
 * Fetch failure analytics via RPC with in-memory / Next.js unstable_cache (60 seconds).
 * Falls back to an inline SQL aggregation if RPC is unavailable.
 */
export const getCachedFailureAnalytics = unstable_cache(
  async function (hours: number): Promise<FailureAnalyticsData> {
    const db = createSupabaseAdminClient();

    // 1. Attempt RPC call
    try {
      const { data, error } = await db.rpc("get_admin_failure_analytics", {
        p_window_hours: hours,
      });

      if (!error && data) {
        return data as FailureAnalyticsData;
      }
      if (error) {
        console.warn("[getCachedFailureAnalytics] RPC error, using fallback queries:", error.message);
      }
    } catch (err) {
      console.warn("[getCachedFailureAnalytics] RPC exception, using fallback queries:", err);
    }

    // 2. Direct query fallback
    const windowStart = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const p24Start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [ordersResult, servicesResult, platformsResult] = await Promise.all([
      db
        .from("orders")
        .select("id,service_id,fulfillment_status,failure_reason,attempt_count,created_at,updated_at")
        .eq("payment_status", "PAID")
        .gte("created_at", windowStart),
      db.from("services").select("id,name,slug,platform_id,provider,provider_service_id"),
      db.from("platforms").select("id,name,slug"),
    ]);

    const orders = ordersResult.data ?? [];
    const services = servicesResult.data ?? [];
    const platforms = platformsResult.data ?? [];

    const platformsById = new Map(platforms.map((p) => [p.id, p]));
    const servicesById = new Map(services.map((s) => [s.id, s]));

    const totalOrders = orders.length;
    const failedOrders = orders.filter((o) => o.fulfillment_status === "FAILED");
    const failedCount = failedOrders.length;
    const failureRate = totalOrders > 0 ? Math.round((failedCount / totalOrders) * 1000) / 10 : 0;

    const awaitingAction = failedOrders.filter(
      (o) => (o as { target_fix_status?: string }).target_fix_status === "AWAITING_CUSTOMER" || o.failure_reason === "provider_insufficient_funds"
    ).length;

    const retriedAndSucceeded = orders.filter(
      (o) => (o.attempt_count ?? 0) > 1 && o.fulfillment_status === "COMPLETED"
    ).length;

    // By Reason
    const reasonCounts = new Map<string, number>();
    for (const fo of failedOrders) {
      const r = fo.failure_reason || "unknown";
      reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
    }
    const byReason: FailureReasonItem[] = Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({
        reason,
        count,
        percentage: failedCount > 0 ? Math.round((count / failedCount) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // By Platform
    const platformStats = new Map<string, { total: number; failed: number }>();
    for (const o of orders) {
      const s = servicesById.get(o.service_id);
      if (!s) continue;
      const pid = s.platform_id;
      const cur = platformStats.get(pid) ?? { total: 0, failed: 0 };
      cur.total++;
      if (o.fulfillment_status === "FAILED") cur.failed++;
      platformStats.set(pid, cur);
    }

    const byPlatform: FailurePlatformItem[] = Array.from(platformStats.entries()).map(([pid, stat]) => {
      const p = platformsById.get(pid);
      return {
        platform_id: pid,
        platform_name: p?.name ?? "Unknown",
        platform_slug: p?.slug ?? "",
        total_orders: stat.total,
        failed_orders: stat.failed,
        failure_rate: stat.total > 0 ? Math.round((stat.failed / stat.total) * 1000) / 10 : 0,
      };
    }).sort((a, b) => b.failed_orders - a.failed_orders);

    // By Service
    const serviceStats = new Map<string, { total: number; failed: number; reasons: Map<string, number> }>();
    for (const o of orders) {
      const cur = serviceStats.get(o.service_id) ?? { total: 0, failed: 0, reasons: new Map() };
      cur.total++;
      if (o.fulfillment_status === "FAILED") {
        cur.failed++;
        const r = o.failure_reason || "unknown";
        cur.reasons.set(r, (cur.reasons.get(r) ?? 0) + 1);
      }
      serviceStats.set(o.service_id, cur);
    }

    const byService: FailureServiceItem[] = Array.from(serviceStats.entries()).map(([sid, stat]) => {
      const s = servicesById.get(sid);
      const p = s ? platformsById.get(s.platform_id) : null;
      let primaryReason: string | null = null;
      let maxCount = 0;
      for (const [r, c] of stat.reasons.entries()) {
        if (c > maxCount) {
          maxCount = c;
          primaryReason = r;
        }
      }
      return {
        service_id: sid,
        service_name: s?.name ?? "Unknown Service",
        service_slug: s?.slug ?? "",
        platform_name: p?.name ?? "",
        platform_slug: p?.slug ?? "",
        provider: s?.provider ?? "",
        provider_service_id: s?.provider_service_id ?? null,
        total_orders: stat.total,
        failed_orders: stat.failed,
        failure_rate: stat.total > 0 ? Math.round((stat.failed / stat.total) * 1000) / 10 : 0,
        primary_failure_reason: primaryReason,
      };
    }).sort((a, b) => b.failure_rate - a.failure_rate || b.total_orders - a.total_orders);

    // Spikes calculation
    const spikes: FailureSpikeItem[] = [];
    const orders24h = orders.filter((o) => o.created_at >= p24Start);
    const service24Stats = new Map<string, { total: number; failed: number; reasons: Map<string, number> }>();
    for (const o of orders24h) {
      const cur = service24Stats.get(o.service_id) ?? { total: 0, failed: 0, reasons: new Map() };
      cur.total++;
      if (o.fulfillment_status === "FAILED") {
        cur.failed++;
        const r = o.failure_reason || "unknown";
        cur.reasons.set(r, (cur.reasons.get(r) ?? 0) + 1);
      }
      service24Stats.set(o.service_id, cur);
    }

    for (const [sid, stat24] of service24Stats.entries()) {
      const statTotal = serviceStats.get(sid);
      const spikeRes = evaluateServiceSpike({
        orders24h: stat24.total,
        failed24h: stat24.failed,
        orders7d: statTotal?.total ?? 0,
        failed7d: statTotal?.failed ?? 0,
      });

      if (spikeRes.isSpike) {
        const s = servicesById.get(sid);
        const p = s ? platformsById.get(s.platform_id) : null;
        let primaryReason: string | null = null;
        let maxCount = 0;
        for (const [r, c] of stat24.reasons.entries()) {
          if (c > maxCount) {
            maxCount = c;
            primaryReason = r;
          }
        }
        spikes.push({
          service_id: sid,
          service_name: s?.name ?? "Service",
          service_slug: s?.slug ?? "",
          platform_name: p?.name ?? "",
          provider: s?.provider ?? "",
          provider_service_id: s?.provider_service_id ?? null,
          rate_24h: Math.round(spikeRes.rate24h * 10) / 10,
          rate_7d: Math.round(spikeRes.rate7d * 10) / 10,
          orders_24h: stat24.total,
          failed_24h: stat24.failed,
          primary_reason: primaryReason,
        });
      }
    }

    return {
      window_hours: hours,
      total_orders: totalOrders,
      failed_orders: failedCount,
      failure_rate: failureRate,
      awaiting_action: awaitingAction,
      retried_succeeded: retriedAndSucceeded,
      median_resolution_seconds: null,
      by_reason: byReason,
      by_platform: byPlatform,
      by_service: byService,
      spikes,
      computed_at: new Date().toISOString(),
    };
  },
  ["admin-failure-analytics"],
  { revalidate: 60, tags: ["admin-failures"] }
);
