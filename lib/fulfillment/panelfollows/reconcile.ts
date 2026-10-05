import "server-only";

import { createSupabaseAdminClient } from "../../supabase/server";
import { PanelFollowsReadOnlyClient } from "./client";

const providerToVanta: Record<string, "SUBMITTED" | "PROCESSING" | "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED"> = { submitted: "SUBMITTED", processing: "PROCESSING", completed: "COMPLETED", partial: "PARTIAL", failed: "FAILED", canceled: "CANCELLED", cancelled: "CANCELLED" };

export async function reconcilePanelFollowsAttempt(attemptId: string, client = new PanelFollowsReadOnlyClient()) {
  const admin = createSupabaseAdminClient();
  const { data: attempt } = await admin.from("provider_orders").select("id,order_id,provider_order_id,attempt_status,status").eq("id", attemptId).maybeSingle();
  if (!attempt?.provider_order_id) throw new Error("Attempt has no provider order ID and requires manual reconciliation.");
  const providerOrder = await client.getOrder(attempt.provider_order_id) as unknown as { status?: string; order?: { status?: string } };
  const rawStatus = String(providerOrder.status || providerOrder.order?.status || "").toLowerCase();
  const status = providerToVanta[rawStatus];
  if (!status) throw new Error("PanelFollows returned an unsupported order status.");
  const { data: saved } = await admin.from("provider_orders").update({ status, attempt_status: "SUBMITTED", raw_response: providerOrder }).eq("id", attempt.id).eq("provider_order_id", attempt.provider_order_id).select().single();
  const current = await admin.from("orders").select("fulfillment_status").eq("id", attempt.order_id).single();
  if (current.error) throw current.error;
  if (current.data?.fulfillment_status !== status) {
    const transition = await admin.rpc("transition_fulfillment_state", { p_order_id: attempt.order_id, p_from: current.data.fulfillment_status, p_to: status });
    if (transition.error) throw transition.error;
    if (transition.data !== true) throw new Error("FULFILLMENT_STATE_TRANSITION_REJECTED");
  }
  return saved;
}
