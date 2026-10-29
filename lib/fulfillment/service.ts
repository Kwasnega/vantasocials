import "server-only";

import { createSupabaseAdminClient } from "../supabase/server";
import { canStartFulfillment } from "./state";

export async function assertOrderEligibleForFulfillment(orderId: string) {
  const admin = createSupabaseAdminClient();
  const { data: order, error } = await admin.from("orders").select("id,payment_status,fulfillment_status,service_id,target_type,target_value,quantity,input_schema_snapshot,input_values,services(provider,provider_service_id,min_quantity,max_quantity,platforms(slug))").eq("id", orderId).maybeSingle();
  if (error) throw error;
  if (!order || order.payment_status !== "PAID" || !["NOT_STARTED", "SUBMITTING"].includes(order.fulfillment_status)) throw new Error("Order is not eligible for fulfillment.");
  const service = Array.isArray(order.services) ? order.services[0] : order.services;
  const platform = Array.isArray(service?.platforms) ? service.platforms[0] : service?.platforms;
  return { ...order, target_type: order.target_type, platform_slug: platform?.slug ?? null, vanta_min: service?.min_quantity ?? null, vanta_max: service?.max_quantity ?? null, provider: service?.provider ?? null, provider_service_id: service?.provider_service_id ?? null };
}

// Actual provider resolution and creation are intentionally not implemented in Phase 2E.1.
