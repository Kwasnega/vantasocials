import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  const { serviceId } = await params;
  if (!serviceId) {
    return NextResponse.json({ error: "Service ID is required." }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  const [service, orders, inputFields, inputMappings, pricingAudit, mappingAudit] = await Promise.all([
    db.from("services").select("id,provider,provider_service_id").eq("id", serviceId).maybeSingle(),
    db.from("orders").select("id", { count: "exact", head: true }).eq("service_id", serviceId),
    db.from("service_input_fields").select("id", { count: "exact", head: true }).eq("service_id", serviceId),
    db.from("service_provider_input_mappings").select("id", { count: "exact", head: true }).eq("service_id", serviceId),
    db.from("pricing_audit_log").select("id", { count: "exact", head: true }).eq("service_id", serviceId),
    db.from("provider_mapping_audit").select("id", { count: "exact", head: true }).eq("service_id", serviceId),
  ]);

  if (service.error || orders.error || inputFields.error || inputMappings.error || pricingAudit.error || mappingAudit.error) {
    return NextResponse.json({ error: "Unable to verify service dependencies. Nothing was deleted." }, { status: 500 });
  }
  if (!service.data) return NextResponse.json({ error: "Service not found." }, { status: 404 });
  if ([orders.count, inputFields.count, inputMappings.count, pricingAudit.count, mappingAudit.count].some((count) => count === null)) {
    return NextResponse.json({ error: "Service dependency counts are incomplete. Nothing was deleted." }, { status: 500 });
  }

  const hasProtectedDependencies = [
    orders.count,
    inputFields.count,
    inputMappings.count,
    pricingAudit.count,
    mappingAudit.count,
  ].some((count) => (count ?? 0) > 0) ||
    Boolean(service.data.provider || service.data.provider_service_id);

  if (hasProtectedDependencies) {
    const { data: service, error: updateError } = await db
      .from("services")
      .update({ active: false })
      .eq("id", serviceId)
      .select("id")
      .maybeSingle();

    if (updateError) {
      return NextResponse.json({ error: "Service has protected history or configuration and could not be deactivated." }, { status: 500 });
    }
    if (!service) return NextResponse.json({ error: "Service not found." }, { status: 404 });

    return NextResponse.json({
      deleted: false,
      deactivated: true,
      message: "Service has protected history or configuration, so it was deactivated rather than permanently deleted.",
    });
  }

  const { data: deleted, error: deleteError } = await db
    .from("services")
    .delete()
    .eq("id", serviceId)
    .select("id")
    .maybeSingle();

  if (deleteError) {
    return NextResponse.json({
      error: deleteError.code === "23503"
        ? "Service acquired a protected dependency and was not deleted."
        : "Unable to delete service. No related history or configuration was removed.",
    }, { status: deleteError.code === "23503" ? 409 : 500 });
  }
  if (!deleted) return NextResponse.json({ error: "Service not found." }, { status: 404 });

  return NextResponse.json({ deleted: true });
}
