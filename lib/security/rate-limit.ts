import "server-only";

import { createSupabaseAdminClient } from "../supabase/server";

export type RateLimitRule = { key: string; limit: number; windowSeconds: number };
export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

const FALLBACK_IP = "unknown";

export function clientIp(request: Request) {
  const vercel = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (vercel) return vercel.slice(0, 128);
  if (process.env.NODE_ENV !== "production") return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 128) || "127.0.0.1";
  return FALLBACK_IP;
}

export async function consumeRateLimits(rules: RateLimitRule[]): Promise<RateLimitResult> {
  if (!rules.length) return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, retryAfterSeconds: 0 };
  const { data, error } = await createSupabaseAdminClient().rpc("consume_rate_limits", { p_requests: rules });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result.allowed !== "boolean") throw new Error("Invalid rate-limit response");
  return { allowed: result.allowed, remaining: Number(result.remaining ?? 0), retryAfterSeconds: Number(result.retry_after_seconds ?? 1) };
}

export function rateLimited(result: RateLimitResult) {
  return new Response(JSON.stringify({ error: "Too many requests. Please retry later." }), {
    status: 429, headers: { "content-type": "application/json", "retry-after": String(Math.max(1, result.retryAfterSeconds)) },
  });
}

export function limiterUnavailable() {
  return new Response(JSON.stringify({ error: "Temporarily unable to process this request. Please retry later." }), { status: 503, headers: { "content-type": "application/json", "retry-after": "5" } });
}

export function rulesFor(endpoint: string, userId: string | null, ip: string, limits: [number, number] | number): RateLimitRule[] {
  const windows = Array.isArray(limits) ? [[limits[0], 60], [limits[1], 3600]] : [[limits, 60]];
  const keys = userId ? [`user:${userId}:${endpoint}`, `ip:${ip}:${endpoint}`] : [`ip:${ip}:${endpoint}`];
  return keys.flatMap((key) => windows.map(([limit, windowSeconds]) => ({ key, limit, windowSeconds })));
}

export async function enforceAdminRateLimit(request: Request, userId: string, endpoint: string, limits: [number, number] | number) {
  const result = await consumeRateLimits(rulesFor(`admin:${endpoint}`, userId, clientIp(request), limits));
  return result.allowed ? null : rateLimited(result);
}

export async function acquireProviderLock(operationKey: string, ownerToken: string) {
  const { data, error } = await createSupabaseAdminClient().rpc("acquire_provider_operation_lock", { p_operation_key: operationKey, p_owner_token: ownerToken, p_lease_seconds: 300 });
  if (error) throw error;
  return data === true;
}

export async function releaseProviderLock(operationKey: string, ownerToken: string) {
  await createSupabaseAdminClient().rpc("release_provider_operation_lock", { p_operation_key: operationKey, p_owner_token: ownerToken });
}
