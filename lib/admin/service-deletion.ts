import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin } from "./auth";
import { createSupabaseAdminClient } from "../supabase/server";

export const REMOVED_SERVICE_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Ensure the fallback [REMOVED SERVICE] record exists in public.services.
 * Used when a service or provider is deleted while preserving historical orders.
 */
export async function ensureRemovedServicePlaceholder(db: ReturnType<typeof createSupabaseAdminClient>) {
  const { data: existing } = await db
    .from("services")
    .select("id")
    .eq("id", REMOVED_SERVICE_ID)
    .maybeSingle();

  if (existing) return REMOVED_SERVICE_ID;

  const { data: platforms } = await db.from("platforms").select("id").limit(1);
  const platformId = platforms?.[0]?.id;
  if (!platformId) throw new Error("No platforms available to mount removed service placeholder.");

  await db.from("services").insert({
    id: REMOVED_SERVICE_ID,
    provider_service_id: "0",
    platform_id: platformId,
    name: "[REMOVED SERVICE]",
    slug: "removed-service-placeholder",
    category: "Other",
    service_type: "custom",
    target_type: "url",
    min_quantity: 1,
    max_quantity: 1000000,
    provider_rate: 0.0001,
    selling_rate: 0.0001,
    currency: "GHS",
    active: false,
    provider: "none",
    provider_data: {},
  });

  return REMOVED_SERVICE_ID;
}

/**
 * Snapshot service details onto attached orders and transfer them to the removed service placeholder.
 */
export async function detachOrdersFromService(
  db: ReturnType<typeof createSupabaseAdminClient>,
  serviceId: string,
  serviceName: string,
  platformName: string,
  providerName: string
) {
  await ensureRemovedServicePlaceholder(db);

  // Fetch all orders using this service
  const { data: orders } = await db
    .from("orders")
    .select("id, target_preview")
    .eq("service_id", serviceId);

  if (!orders || orders.length === 0) return 0;

  for (const order of orders) {
    const existingPreview = (order.target_preview && typeof order.target_preview === "object") ? order.target_preview : {};
    const updatedPreview = {
      ...existingPreview,
      _service_name_snapshot: existingPreview._service_name_snapshot || serviceName,
      _platform_snapshot: existingPreview._platform_snapshot || platformName,
      _provider_snapshot: existingPreview._provider_snapshot || providerName,
      _service_removed: true,
      _service_removed_at: new Date().toISOString(),
    };

    await db
      .from("orders")
      .update({
        service_id: REMOVED_SERVICE_ID,
        target_preview: updatedPreview,
      })
      .eq("id", order.id);
  }

  return orders.length;
}
