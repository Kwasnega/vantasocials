import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin } from "../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";
import { detachOrdersFromService, REMOVED_SERVICE_ID } from "../../../../../lib/admin/service-deletion";

/**
 * DELETE /api/admin/providers/[provider]
 * Deletes all services under a provider even when orders exist under them.
 * Snapshots the service details onto attached orders, detaches them to REMOVED_SERVICE_ID,
 * deletes provider input fields/mappings, removes the services, and writes to admin_action_log.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { admin, user } = await requireAdmin();
  if (!admin || !user) {
    return NextResponse.json({ error: "Unauthorized. Admin permissions required." }, { status: 401 });
  }

  const { provider } = await params;
  if (!provider) return NextResponse.json({ error: "Provider identifier is required." }, { status: 400 });

  let confirmation = "";
  try {
    const body = await req.json();
    confirmation = (body?.confirmation ?? "").trim();
  } catch {
    // optional body
  }

  // Validate confirmation
  if (confirmation !== "DELETE" && confirmation.toLowerCase() !== provider.toLowerCase()) {
    return NextResponse.json(
      { error: `Confirmation required. Type 'DELETE' or '${provider}' to confirm provider deletion.` },
      { status: 400 }
    );
  }

  const db = createSupabaseAdminClient();

  // Find all services for this provider
  const { data: services, error: sErr } = await db
    .from("services")
    .select("id, name, provider, platforms(name)")
    .eq("provider", provider);

  if (sErr) {
    return NextResponse.json({ error: "Unable to query provider services." }, { status: 500 });
  }

  let totalDetachedOrders = 0;
  const deletedServiceIds: string[] = [];

  for (const service of services || []) {
    if (service.id === REMOVED_SERVICE_ID) continue;

    const platformName = (service.platforms as { name?: string } | null)?.name || "General";
    const detached = await detachOrdersFromService(
      db,
      service.id,
      service.name,
      platformName,
      service.provider || provider
    );
    totalDetachedOrders += detached;

    // Delete mappings & fields
    await db.from("service_provider_input_mappings").delete().eq("service_id", service.id);
    await db.from("service_input_fields").delete().eq("service_id", service.id);
    await db.from("provider_mapping_audit").delete().eq("service_id", service.id);
    await db.from("pricing_audit_log").delete().eq("service_id", service.id);

    // Delete service
    await db.from("services").delete().eq("id", service.id);
    deletedServiceIds.push(service.id);
  }

  // Delete provider health cache if exists
  try {
    await db.from("provider_health").delete().eq("provider", provider);
  } catch {
    // best-effort
  }

  // Audit log
  await db.from("admin_action_log").insert({
    action: "DELETE_PROVIDER",
    performed_by: user.id,
    details: {
      provider,
      services_count: deletedServiceIds.length,
      deleted_service_ids: deletedServiceIds,
      detached_orders_count: totalDetachedOrders,
    },
    result_summary: {
      deleted: true,
      services_deleted: deletedServiceIds.length,
      orders_preserved: totalDetachedOrders,
    },
  });

  try { revalidateTag("catalog"); } catch { /* best-effort */ }

  return NextResponse.json({
    deleted: true,
    provider,
    servicesDeleted: deletedServiceIds.length,
    ordersPreserved: totalDetachedOrders,
  });
}
