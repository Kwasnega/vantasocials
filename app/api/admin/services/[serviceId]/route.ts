import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin } from "../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../../lib/security/rate-limit";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const rejected = await enforceAdminRateLimit(request, user.id, "service-delete", [30, 30]);
    if (rejected) return rejected;
  } catch {
    return limiterUnavailable();
  }

  const { serviceId } = await params;
  if (!serviceId) {
    return NextResponse.json({ error: "Service ID is required." }, { status: 400 });
  }

  const db = createSupabaseAdminClient();

  // Verify the service exists
  const { data: service, error: serviceError } = await db
    .from("services")
    .select("id")
    .eq("id", serviceId)
    .maybeSingle();

  if (serviceError) {
    return NextResponse.json({ error: "Unable to verify service. Nothing was deleted." }, { status: 500 });
  }
  if (!service) return NextResponse.json({ error: "Service not found." }, { status: 404 });

  // Check for orders — the only hard dependency that should block deletion.
  // Input fields, mappings, and audit logs are deleted via CASCADE.
  const { count: orderCount, error: ordersError } = await db
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("service_id", serviceId);

  if (ordersError || orderCount === null) {
    return NextResponse.json({ error: "Unable to verify order history. Nothing was deleted." }, { status: 500 });
  }

  if (orderCount > 0) {
    // Service has real customer orders — cannot safely erase it.
    return NextResponse.json({
      deleted: false,
      error: `This service has ${orderCount} order(s) and cannot be deleted. Remove the orders first or contact support.`,
    }, { status: 409 });
  }

  // Pre-delete dependent records that have ON DELETE RESTRICT foreign keys:
  // 1. service_provider_input_mappings (references service_input_fields and services)
  await db.from("service_provider_input_mappings").delete().eq("service_id", serviceId);
  // 2. service_input_fields (references services)
  await db.from("service_input_fields").delete().eq("service_id", serviceId);
  // 3. provider_mapping_audit (references services with on delete restrict)
  await db.from("provider_mapping_audit").delete().eq("service_id", serviceId);
  // 4. pricing_audit_log (references services)
  await db.from("pricing_audit_log").delete().eq("service_id", serviceId);

  // Now hard-delete the service itself
  const { data: deleted, error: deleteError } = await db
    .from("services")
    .delete()
    .eq("id", serviceId)
    .select("id")
    .maybeSingle();

  if (deleteError) {
    return NextResponse.json({
      error: deleteError.code === "23503"
        ? "Service has a protected dependency and could not be deleted."
        : "Unable to delete service.",
    }, { status: deleteError.code === "23503" ? 409 : 500 });
  }
  if (!deleted) return NextResponse.json({ error: "Service not found." }, { status: 404 });

  try { revalidateTag("catalog"); } catch { /* best-effort revalidation */ }
  return NextResponse.json({ deleted: true });
}
