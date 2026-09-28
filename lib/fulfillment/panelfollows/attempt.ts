import "server-only";

import { createSupabaseAdminClient } from "../../supabase/server";
import { assertOrderEligibleForFulfillment } from "../service";
import { PanelFollowsReadOnlyClient, normalizeProviderService } from "./client";
import { panelFollowsCandidateMappings } from "./mappings";
import { panelFollowsIdempotencyKey } from "./idempotency";
import { previewPanelFollowsFulfillment } from "./fulfillment";
import { PanelFollowsError } from "./client";

type Attempt = { id: string; order_id: string; provider: string; provider_service_id: string; idempotency_key: string; attempt_status: string; provider_order_id: string | null; status: string; provider_cost: string | null; currency: string; target_value: string | null; quantity: number };

export async function claimPanelFollowsAttempt(orderId: string, vantaSlug: string, targetValue: string, quantity: number, client = new PanelFollowsReadOnlyClient()) {
  const mapping = panelFollowsCandidateMappings.find((candidate) => candidate.vantaSlug === vantaSlug && candidate.status === "APPROVED_FOR_MANUAL_ACTIVATION" && !candidate.active);
  if (!mapping) throw new Error("No eligible PanelFollows mapping exists.");
  const order = await assertOrderEligibleForFulfillment(orderId);
  const provider = normalizeProviderService(await client.getService(mapping.providerServiceId));
  const preview = await previewPanelFollowsFulfillment({ orderId, vantaSlug, target: targetValue, quantity, provider, client });
  const key = panelFollowsIdempotencyKey(orderId, mapping.providerServiceId);
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin.from("provider_orders").select("id,order_id,provider,provider_service_id,idempotency_key,attempt_status,provider_order_id,status,provider_cost,currency,target_value,quantity").eq("idempotency_key", key).maybeSingle();
  if (existing) { console.info(JSON.stringify({ event: "fulfillment_attempt_reused", orderId, attemptId: existing.id, attemptStatus: existing.attempt_status })); return { kind: "existing" as const, attempt: existing as Attempt, preview }; }
  const { data: attempt, error } = await admin.from("provider_orders").insert({ order_id: order.id, attempt_number: 1, provider: "panelfollows", provider_service_id: mapping.providerServiceId, idempotency_key: key, target_value: preview.target, quantity, provider_cost: preview.providerCost, charge: preview.providerCost, currency: "USD", status: "NOT_STARTED", attempt_status: "PENDING_SUBMISSION", request_started_at: new Date().toISOString() }).select("id,order_id,provider,provider_service_id,idempotency_key,attempt_status,provider_order_id,status,provider_cost,currency,target_value,quantity").single();
  if (error) {
    const { data: raced } = await admin.from("provider_orders").select("id,order_id,provider,provider_service_id,idempotency_key,attempt_status,provider_order_id,status,provider_cost,currency,target_value,quantity").eq("idempotency_key", key).maybeSingle();
    if (raced) { console.info(JSON.stringify({ event: "fulfillment_attempt_race_reused", orderId, attemptId: raced.id, attemptStatus: raced.attempt_status })); return { kind: "existing" as const, attempt: raced as Attempt, preview }; }
    throw new Error("Unable to create fulfillment attempt.");
  }
  console.info(JSON.stringify({ event: "fulfillment_attempt_claimed", orderId, attemptId: attempt.id, provider: "panelfollows", attemptStatus: "PENDING_SUBMISSION" }));
  return { kind: "created" as const, attempt: attempt as Attempt, preview };
}

export async function submitPanelFollowsAttempt(attemptId: string, client = new PanelFollowsReadOnlyClient()) {
  const admin = createSupabaseAdminClient();
  const { data: attempt } = await admin.from("provider_orders").select("id,attempt_status,provider_service_id,target_value,quantity,idempotency_key,provider_cost,currency").eq("id", attemptId).maybeSingle();
  if (!attempt) throw new Error("Fulfillment attempt not found.");
  if (attempt.attempt_status === "SUBMITTED" || attempt.attempt_status === "UNKNOWN_PENDING_RECONCILIATION") return attempt;
  if (attempt.attempt_status !== "PENDING_SUBMISSION") throw new Error("Fulfillment attempt is not pending submission.");
  try {
    if (!attempt.target_value) throw new Error("Fulfillment attempt has no target.");
    const account = await client.getAccount();
    if (account.currency !== "USD") throw new PanelFollowsError("PanelFollows account currency is not supported.", 502, "UNSUPPORTED_CURRENCY");
    const toUnits = (value: string) => { const [whole, fraction = ""] = value.split("."); return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0").slice(0, 6)); };
    if (!attempt.provider_cost || toUnits(account.balance) < toUnits(attempt.provider_cost)) throw new PanelFollowsError("PanelFollows balance is insufficient.", 402, "INSUFFICIENT_BALANCE");
    const response = await client.createOrder({ service: Number(attempt.provider_service_id), link: attempt.target_value, quantity: attempt.quantity }, attempt.idempotency_key);
    const providerOrderId = String(response.id);
    const { data: saved } = await admin.from("provider_orders").update({ provider_order_id: providerOrderId, status: "SUBMITTED", attempt_status: "SUBMITTED", response_received_at: new Date().toISOString(), raw_response: { provider_order_id: providerOrderId } }).eq("id", attempt.id).eq("attempt_status", "PENDING_SUBMISSION").select().single();
    return saved;
  } catch (error) {
    const unknown = error instanceof PanelFollowsError && error.status === 408;
    const attemptStatus = unknown ? "UNKNOWN_PENDING_RECONCILIATION" : "FAILED_BEFORE_SUBMISSION";
    await admin.from("provider_orders").update({ attempt_status: attemptStatus, error_code: error instanceof PanelFollowsError ? error.code || "PROVIDER_ERROR" : "INTERNAL_ERROR", response_received_at: new Date().toISOString() }).eq("id", attempt.id).eq("attempt_status", "PENDING_SUBMISSION");
    console.warn(JSON.stringify({ event: "fulfillment_attempt_failed", attemptId: attempt.id, attemptStatus, retryable: !unknown }));
    throw error;
  }
}
