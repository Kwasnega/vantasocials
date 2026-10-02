import "server-only";
import crypto from "node:crypto";
import { createSupabaseAdminClient } from "../../supabase/server";

const ENDPOINT = "https://reliablesmm.com/api/v2";

export class ReliableSMMError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type RawService = Record<string, unknown>;
export type ReliableSMMService = { service: number | string; name: string; type?: string; category?: string; rate: string | number; min: string | number; max: string | number; refill?: boolean | string | number; cancel?: boolean | string | number; [key: string]: unknown };
export type ReliableSMMBalance = { balance: string; currency: string };

function apiKey() { const value = process.env.RELIABLESMM_API_KEY; if (!value) throw new ReliableSMMError("ReliableSMM is not configured.", 503, "MISSING_API_KEY"); return value; }
function requestIntervalMs() {
  const raw = process.env.RELIABLESMM_MIN_REQUEST_INTERVAL_MS;
  if (raw === undefined || raw === "") return 1000;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 100 || value > 60000) throw new ReliableSMMError("ReliableSMM request interval configuration is invalid.", 503, "INVALID_REQUEST_INTERVAL");
  return value;
}

async function request<T>(action: string, params: Record<string, string | number> = {}, gateAcquired = false): Promise<T> {
  if (!gateAcquired) {
    const gate = await createSupabaseAdminClient().rpc("acquire_provider_request_slot", { p_operation_key: "reliablesmm:api", p_owner_token: crypto.randomUUID(), p_min_interval_ms: requestIntervalMs() });
    if (gate.error || gate.data !== true) throw new ReliableSMMError("ReliableSMM request rate limit unavailable or active.", 429, "PROVIDER_RATE_LIMITED");
  }
  const body = new URLSearchParams({ key: apiKey(), action, ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])) });
  let response: Response;
  try { response = await fetch(ENDPOINT, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body, cache: "no-store", signal: AbortSignal.timeout(15000) }); }
  catch (error) { throw new ReliableSMMError("ReliableSMM request outcome is unknown.", 408, error instanceof Error && error.name === "TimeoutError" ? "TIMEOUT" : "NETWORK_ERROR"); }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ReliableSMMError("ReliableSMM request failed.", response.status, "HTTP_ERROR");
  if (!json || typeof json !== "object") throw new ReliableSMMError("ReliableSMM returned malformed JSON.", response.status, "MALFORMED_JSON");
  const value = json as RawService & { error?: unknown };
  if (value.error) throw new ReliableSMMError("ReliableSMM rejected the request before creating an order.", response.status, "PROVIDER_REJECTED");
  return json as T;
}

export class ReliableSMMReadOnlyClient {
  async acquireRequestGate() {
    const gate = await createSupabaseAdminClient().rpc("acquire_provider_request_slot", { p_operation_key: "reliablesmm:api", p_owner_token: crypto.randomUUID(), p_min_interval_ms: requestIntervalMs() });
    if (gate.error || gate.data !== true) throw new ReliableSMMError("ReliableSMM request rate limit unavailable or active.", 429, "PROVIDER_RATE_LIMITED");
  }

  async getServices() { return request<ReliableSMMService[]>("services"); }
  async getBalance() {
    const result = await request<{ balance?: string | number; currency?: string }>("balance");
    if (result.balance === undefined || !result.currency) throw new ReliableSMMError("ReliableSMM returned an incomplete balance.", 502, "INVALID_BALANCE");
    return { balance: String(result.balance), currency: String(result.currency) } satisfies ReliableSMMBalance;
  }

  async createR4TestOrder(input: { service: number; link: string; quantity: 100 }) {
    if (process.env.R4_TEST_MODE !== "true") throw new ReliableSMMError("R4 test mode is disabled.", 423, "R4_TEST_MODE_DISABLED");
    if (![7486, 5661, 7603].includes(input.service) || input.quantity !== 100) throw new ReliableSMMError("R4 test input is not approved.", 400, "R4_INPUT_NOT_APPROVED");
    return request<{ order: number }>("add", input);
  }

  async createOrder(input: { service: number; link: string; quantity: number }, gateAcquired = false) {
    if (process.env.PANELS_LIVE_FULFILLMENT_ENABLED !== "true") throw new ReliableSMMError("Live fulfillment is disabled.", 423, "LIVE_FULFILLMENT_DISABLED");
    return request<{ order: number }>("add", input, gateAcquired);
  }

  async getStatus(providerOrderId: string) { return request<{ charge: string; start_count: number; status: string; remains: number; currency: string }>("status", { order: providerOrderId }); }
}
