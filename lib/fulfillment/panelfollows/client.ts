import "server-only";

const BASE_URL = "https://panelfollows.com/api/v3";

export class PanelFollowsError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

export type PanelFollowsField = { name: string; type: string; required: boolean; min?: number; max?: number; determines_quantity?: boolean; label?: string; description?: string };
export type PanelFollowsService = { object: "service"; id: number; name: string; description?: string; type: string; platform: string; category?: { slug: string; name: string }; pricing: { rate: string; currency: string; unit: "per_1000" | "per_order"; unit_note?: string }; limits: { min: number; max: number }; features: { refill: boolean; cancel: boolean; dripfeed: boolean }; average_time_seconds?: number; fields: PanelFollowsField[]; is_active: boolean; updated_at?: string };
export type ProviderService = { provider: "panelfollows"; providerServiceId: string; category: string; name: string; description: string | null; pricingUnit: "per_1000" | "per_order"; providerRate: string; currency: string; minQuantity: number; maxQuantity: number; refill: boolean; cancel: boolean; dripFeed: boolean; averageTimeSeconds: number | null; fields: PanelFollowsField[]; rawMetadata: { type: string; platform: string; updated_at?: string; is_active: boolean } };

function secret() { const value = process.env.PANELFOLLOWS_API_KEY; if (!value) throw new PanelFollowsError("PanelFollows is not configured.", 503); return value; }

async function request<T>(path: string, init?: RequestInit): Promise<{ data: T; headers: Headers }> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, { ...init, headers: { Authorization: `Bearer ${secret()}`, Accept: "application/json", "Content-Type": "application/json", ...(init?.headers || {}) }, cache: "no-store", signal: AbortSignal.timeout(15000) });
  } catch (error) {
    throw new PanelFollowsError("PanelFollows request outcome is unknown.", 408, error instanceof Error && error.name === "TimeoutError" ? "TIMEOUT" : "NETWORK_ERROR");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) { const e = body && typeof body === "object" ? body as { error?: { code?: string; message?: string }; message?: string } : {}; throw new PanelFollowsError(e.error?.message || e.message || "PanelFollows request failed.", response.status, e.error?.code); }
  if (!body || typeof body !== "object") throw new PanelFollowsError("PanelFollows returned malformed JSON.", response.status);
  return { data: body as T, headers: response.headers };
}

export type PanelFollowsAccount = { object: "account"; balance: string; currency: string; rate_limit?: { limit: number; remaining: number; reset_seconds: number; window_seconds: number } };
export type PanelFollowsOrder = { object: "order"; id: number; status: string; service?: number; quantity?: number; charge?: string; currency?: string; start_count?: number | null; remains?: number | null; processing_delayed?: boolean };
export type PanelFollowsList = { object: "list"; data: PanelFollowsService[]; has_more: boolean; next_cursor?: string | null };

export class PanelFollowsReadOnlyClient {
  async getAccount() { return (await request<PanelFollowsAccount>("/account")).data; }
  async getServicesPage(cursor?: string) { const query = new URLSearchParams({ limit: "100" }); if (cursor) query.set("starting_after", cursor); return (await request<PanelFollowsList>(`/services?${query}`)).data; }
  async getService(serviceId: string) { return (await request<PanelFollowsService>(`/services/${encodeURIComponent(serviceId)}`)).data; }
  async getAllServices() { const services: PanelFollowsService[] = []; let cursor: string | undefined; for (let page = 0; page < 100; page++) { const result = await this.getServicesPage(cursor); services.push(...result.data); if (!result.has_more || !result.next_cursor) return services; cursor = result.next_cursor; } throw new PanelFollowsError("PanelFollows catalog pagination exceeded the safety limit.", 502); }

  async createOrder(input: { service: number; link: string; quantity: number }, idempotencyKey: string) {
    if (process.env.PANELS_LIVE_FULFILLMENT_ENABLED !== "true") throw new PanelFollowsError("Live fulfillment is disabled.", 423, "LIVE_FULFILLMENT_DISABLED");
    return (await request<{ object: "order"; id: number }>("/orders", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input) })).data;
  }

  async getOrder(providerOrderId: string) {
    return (await request<PanelFollowsOrder>(`/orders/${encodeURIComponent(providerOrderId)}`)).data;
  }
}

export function normalizeProviderService(service: PanelFollowsService): ProviderService { return { provider: "panelfollows", providerServiceId: String(service.id), category: service.category?.slug || "", name: service.name, description: service.description || null, pricingUnit: service.pricing.unit, providerRate: service.pricing.rate, currency: service.pricing.currency, minQuantity: service.limits.min, maxQuantity: service.limits.max, refill: service.features.refill, cancel: service.features.cancel, dripFeed: service.features.dripfeed, averageTimeSeconds: service.average_time_seconds ?? null, fields: service.fields, rawMetadata: { type: service.type, platform: service.platform, updated_at: service.updated_at, is_active: service.is_active } }; }
