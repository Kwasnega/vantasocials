/**
 * lib/admin/failures/types.ts
 * Pure types and evaluation functions for Failures Analytics.
 */

export interface FailureReasonItem {
  reason: string;
  count: number;
  percentage: number;
}

export interface FailurePlatformItem {
  platform_id: string;
  platform_name: string;
  platform_slug: string;
  total_orders: number;
  failed_orders: number;
  failure_rate: number;
}

export interface FailureServiceItem {
  service_id: string;
  service_name: string;
  service_slug: string;
  platform_name: string;
  platform_slug: string;
  provider: string;
  provider_service_id: string | null;
  total_orders: number;
  failed_orders: number;
  failure_rate: number;
  primary_failure_reason: string | null;
}

export interface FailureSpikeItem {
  service_id: string;
  service_name: string;
  service_slug: string;
  platform_name: string;
  provider: string;
  provider_service_id: string | null;
  rate_24h: number;
  rate_7d: number;
  orders_24h: number;
  failed_24h: number;
  primary_reason: string | null;
}

export interface FailureAnalyticsData {
  window_hours: number;
  total_orders: number;
  failed_orders: number;
  failure_rate: number;
  awaiting_action: number;
  retried_succeeded: number;
  median_resolution_seconds: number | null;
  by_reason: FailureReasonItem[];
  by_platform: FailurePlatformItem[];
  by_service: FailureServiceItem[];
  spikes: FailureSpikeItem[];
  computed_at: string;
}

/**
 * Maps window key ('24h' | '7d' | '30d') to integer hours.
 */
export function windowKeyToHours(windowKey: string): number {
  switch (windowKey) {
    case "24h":
      return 24;
    case "30d":
      return 720;
    case "7d":
    default:
      return 168;
  }
}

/**
 * Evaluates whether a service has an acute failure spike:
 * - Last-24h failure rate is > 2x its 7-day rate
 * - AND last-24h rate > 15%
 * - AND at least 10 orders in last 24h
 */
export function evaluateServiceSpike(params: {
  orders24h: number;
  failed24h: number;
  orders7d: number;
  failed7d: number;
}): { isSpike: boolean; rate24h: number; rate7d: number } {
  const { orders24h, failed24h, orders7d, failed7d } = params;
  if (orders24h < 10) return { isSpike: false, rate24h: 0, rate7d: 0 };

  const rate24h = (failed24h / orders24h) * 100;
  const rate7d = orders7d > 0 ? (failed7d / orders7d) * 100 : 0;

  if (rate24h <= 15) return { isSpike: false, rate24h, rate7d };

  const isSpike = rate7d === 0 || rate24h > 2 * rate7d;
  return { isSpike, rate24h, rate7d };
}
