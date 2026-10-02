import "server-only";
import crypto from "node:crypto";

import { createSupabaseAdminClient } from "../../supabase/server";
import { assertOrderEligibleForFulfillment } from "../service";
import { ReliableSMMAdapter } from "./adapter";
import { resolveActiveMapping } from "../mapping";
import { validatePanelFollowsTarget } from "../panelfollows/validation";
import { reliableSMMCost } from "./pricing";
import { ReliableSMMReadOnlyClient } from "./client";

export async function fulfillReliableSMMOrder(input: { orderId: string; vantaSlug: string; targetValue: string; quantity: number }, adapter = new ReliableSMMAdapter()) {
  const mapping = resolveActiveMapping(input.vantaSlug);
  if (!mapping || mapping.provider !== "reliablesmm") throw new Error("ReliableSMM mapping is inactive and requires manual review.");
  if (input.vantaSlug === "instagram-views" && !validatePanelFollowsTarget(input.vantaSlug, input.targetValue).valid) throw new Error("Invalid Instagram post/reel URL.");
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 100 || input.quantity > 100000) throw new Error("Invalid quantity.");
  const order = await assertOrderEligibleForFulfillment(input.orderId);
  const account = await adapter.getBalance();
  if (account.currency !== "USD") throw new Error("ReliableSMM account currency is not supported.");
  const catalog = await new ReliableSMMReadOnlyClient().getServices();
  const providerService = catalog.find((service) => String(service.service) === mapping.providerServiceId);
  if (!providerService) throw new Error("ReliableSMM service is unavailable.");
  const rate = String(providerService.rate);
  const providerCost = reliableSMMCost(rate, input.quantity);
  const admin = createSupabaseAdminClient();
  const key = `vanta:${order.id}:reliablesmm:${mapping.providerServiceId}`;
  const { data: existing } = await admin.from("provider_orders").select("id,attempt_status,provider_order_id,status").eq("idempotency_key", key).maybeSingle();
  if (existing?.attempt_status === "FAILED_BEFORE_SUBMISSION") {
    const retry = await admin.rpc("create_safe_provider_retry", { p_attempt_id: existing.id });
    if (retry.error) throw retry.error;
    if (!retry.data) return existing;
    const { data: next, error: nextError } = await admin.from("provider_orders").select("id,attempt_status,provider_order_id,status,provider_service_id,target_value,quantity").eq("id", retry.data).single();
    if (nextError || !next) throw nextError || new Error("Unable to load retry attempt.");
    return submitAttempt(next, adapter, admin);
  }
  if (existing) return existing;
  const { data: attempt, error } = await admin.from("provider_orders").insert({ order_id: order.id, attempt_number: 1, provider: "reliablesmm", provider_service_id: mapping.providerServiceId, idempotency_key: key, target_value: input.targetValue, quantity: input.quantity, provider_cost: providerCost, currency: "USD", status: "NOT_STARTED", attempt_status: "PENDING_SUBMISSION", request_started_at: new Date().toISOString() }).select().single();
  if (error) { const { data: raced } = await admin.from("provider_orders").select("id,attempt_status,provider_order_id,status").eq("idempotency_key", key).maybeSingle(); if (raced) return raced; throw new Error("Unable to claim ReliableSMM attempt."); }
  if (attempt.attempt_status !== "PENDING_SUBMISSION") return attempt;
  return submitAttempt(attempt, adapter, admin);
}

async function submitAttempt(attempt: { id: string; attempt_status: string; provider_service_id?: string; target_value?: string; quantity?: number }, adapter: ReliableSMMAdapter, admin: ReturnType<typeof createSupabaseAdminClient>) {
  if (attempt.attempt_status !== "PENDING_SUBMISSION") return attempt;
  const ownerToken = crypto.randomUUID();
  const providerLock = await admin.rpc("acquire_provider_operation_lock", { p_operation_key: "reliablesmm:submission", p_owner_token: ownerToken, p_lease_seconds: 60 });
  if (providerLock.error || providerLock.data !== true) throw new Error("ReliableSMM submission is busy; retry later.");
  try {
    const lease = await admin.rpc("acquire_submission_lease", { p_attempt_id: attempt.id, p_owner_token: ownerToken, p_lease_seconds: 60 });
    if (lease.error || lease.data !== true) throw new Error("Unable to acquire submission lease.");
    await adapter.acquireRequestGate();
    const boundary = await admin.rpc("record_submission_boundary", { p_attempt_id: attempt.id, p_owner_token: ownerToken });
    if (boundary.error || boundary.data !== true) throw new Error("Unable to record submission boundary.");
    const result = await adapter.createOrder({ providerServiceId: String(attempt.provider_service_id), targetValue: String(attempt.target_value), quantity: Number(attempt.quantity) }, true);
    const saved = await admin.rpc("persist_provider_submission_success", { p_attempt_id: attempt.id, p_owner_token: ownerToken, p_provider_order_id: result.providerOrderId, p_status: "SUBMITTED", p_raw_response: result.rawResponse });
    if (saved.error || saved.data !== true) throw new Error("Provider response persistence was ambiguous.");
    return (await admin.from("provider_orders").select("id,attempt_status,provider_order_id,status").eq("id", attempt.id).single()).data;
  } catch (error) {
    const unknown = error instanceof Error && ((error as { status?: number }).status === 408 || error.message.includes("ambiguous"));
    await admin.rpc("record_submission_failure", { p_attempt_id: attempt.id, p_owner_token: ownerToken, p_ambiguous: unknown, p_error: error instanceof Error ? error.message : "PROVIDER_ERROR" });
    throw error;
  } finally {
    await admin.rpc("release_provider_operation_lock", { p_operation_key: "reliablesmm:submission", p_owner_token: ownerToken });
  }
}
