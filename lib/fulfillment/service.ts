import "server-only";

import { createSupabaseAdminClient } from "../supabase/server";
import { canStartFulfillment } from "./state";

export async function assertOrderEligibleForFulfillment(orderId: string) {
  const admin = createSupabaseAdminClient();
  const { data: order, error } = await admin.from("orders").select("id,payment_status,fulfillment_status,service_id,target_value,quantity").eq("id", orderId).maybeSingle();
  if (error) throw error;
  if (!order || order.payment_status !== "PAID" || !["NOT_STARTED", "SUBMITTING"].includes(order.fulfillment_status)) throw new Error("Order is not eligible for fulfillment.");
  return order;
}

// Actual provider resolution and creation are intentionally not implemented in Phase 2E.1.
