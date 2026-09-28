import "server-only";

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
  if (existing) return existing;
  const { data: attempt, error } = await admin.from("provider_orders").insert({ order_id: order.id, attempt_number: 1, provider: "reliablesmm", provider_service_id: mapping.providerServiceId, idempotency_key: key, target_value: input.targetValue, quantity: input.quantity, provider_cost: providerCost, currency: "USD", status: "NOT_STARTED", attempt_status: "PENDING_SUBMISSION", request_started_at: new Date().toISOString() }).select().single();
  if (error) { const { data: raced } = await admin.from("provider_orders").select("id,attempt_status,provider_order_id,status").eq("idempotency_key", key).maybeSingle(); if (raced) return raced; throw new Error("Unable to claim ReliableSMM attempt."); }
  if (attempt.attempt_status !== "PENDING_SUBMISSION") return attempt;
  try {
    const result = await adapter.createOrder({ providerServiceId: mapping.providerServiceId, targetValue: input.targetValue, quantity: input.quantity });
    return (await admin.from("provider_orders").update({ provider_order_id: result.providerOrderId, status: "SUBMITTED", attempt_status: "SUBMITTED", charge: result.charge, currency: result.currency || "USD", raw_response: result.rawResponse, response_received_at: new Date().toISOString() }).eq("id", attempt.id).eq("attempt_status", "PENDING_SUBMISSION").select().single()).data;
  } catch (error) {
    const unknown = error instanceof Error && (error as { status?: number }).status === 408;
    await admin.from("provider_orders").update({ attempt_status: unknown ? "UNKNOWN_PENDING_RECONCILIATION" : "FAILED_BEFORE_SUBMISSION", error_code: unknown ? "UNKNOWN_SUBMISSION" : "PROVIDER_ERROR", response_received_at: new Date().toISOString() }).eq("id", attempt.id).eq("attempt_status", "PENDING_SUBMISSION");
    throw error;
  }
}
