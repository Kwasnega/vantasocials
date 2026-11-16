import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin } from "../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";
import { detachOrdersFromService, ensureRemovedServicePlaceholder, REMOVED_SERVICE_ID } from "../../../../../lib/admin/service-deletion";

/**
 * DELETE /api/admin/services/[serviceId]
 * Allows deleting a service even when orders exist under it.
 * Snapshots the service details onto the orders, transitions them to REMOVED_SERVICE_ID,
 * deletes dependent input fields and mappings, logs to admin_action_log, and hard-deletes the service.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ serviceId: string }> },
) {
  const { admin, user } = await requireAdmin();
  if (!admin || !user) {
    return NextResponse.json({ error: "Unauthorized. Admin permissions required." }, { status: 401 });
  }

  const { serviceId } = await params;
  if (!serviceId) return NextResponse.json({ error: "serviceId is required." }, { status: 400 });

  if (serviceId === REMOVED_SERVICE_ID) {
    return NextResponse.json({ error: "Cannot delete the removed service system placeholder." }, { status: 400 });
  }

  // Parse body for confirmation if supplied
  let confirmation = "";
  try {
    const body = await req.json();
    confirmation = (body?.confirmation ?? "").trim();
  } catch {
    // optional body
  }

  const db = createSupabaseAdminClient();

  // Look up service and its platform
  const { data: service, error: serviceError } = await db
    .from("services")
    .select("id, name, provider, platforms(name)")
    .eq("id", serviceId)
    .maybeSingle();

  if (serviceError) {
    return NextResponse.json({ error: "Unable to verify service. Nothing was deleted." }, { status: 500 });
  }
  if (!service) return NextResponse.json({ error: "Service not found." }, { status: 404 });

  // Count orders
  const { count: orderCount } = await db
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("service_id", serviceId);

  // If orders exist, require typed "DELETE" confirmation
  if ((orderCount ?? 0) > 0 && confirmation !== "DELETE") {
    return NextResponse.json(
      { error: `This service has ${orderCount} order(s). Type DELETE to confirm deletion.` },
      { status: 400 }
    );
  }

  // 1. Snapshot and detach attached orders
  const platformName = (service.platforms as { name?: string } | null)?.name || "General";
  const detachedCount = await detachOrdersFromService(
    db,
    serviceId,
    service.name,
    platformName,
    service.provider || "none"
  );

  // 2. Pre-delete dependent records
  await db.from("service_provider_input_mappings").delete().eq("service_id", serviceId);
  await db.from("service_input_fields").delete().eq("service_id", serviceId);
  await db.from("provider_mapping_audit").delete().eq("service_id", serviceId);
  await db.from("pricing_audit_log").delete().eq("service_id", serviceId);

  // 3. Delete the service
  const { data: deleted, error: deleteError } = await db
    .from("services")
    .delete()
    .eq("id", serviceId)
    .select("id")
    .maybeSingle();

  if (deleteError) {
    console.error("[Service Delete Error]:", deleteError);
    return NextResponse.json(
      { error: `Unable to delete service: ${deleteError.message}` },
      { status: 500 }
    );
  }

  // 4. Log to admin_action_log
  await db.from("admin_action_log").insert({
    action: "DELETE_SERVICE",
    performed_by: user.id,
    details: {
      service_id: serviceId,
      service_name: service.name,
      provider: service.provider,
      platform: platformName,
      detached_orders_count: detachedCount,
    },
    result_summary: {
      deleted: true,
      detached_orders: detachedCount,
    },
  });

  try { revalidateTag("catalog"); } catch { /* best-effort */ }

  return NextResponse.json({
    deleted: true,
    detachedOrders: detachedCount,
    serviceId,
  });
}
