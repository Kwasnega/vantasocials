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

  // Check if service has any existing orders
  const { count: ordersCount } = await db
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("service_id", serviceId);

  if (ordersCount && ordersCount > 0) {
    // If it has orders, deactivate it instead of hard deleting to preserve historical order integrity
    const { error: updateError } = await db
      .from("services")
      .update({ active: false })
      .eq("id", serviceId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      deleted: false,
      deactivated: true,
      message: "Service has order history so it was deactivated/hidden rather than permanently deleted.",
    });
  }

  // Hard delete if no orders exist
  // Clean up related input mappings and fields first
  await db.from("service_input_mappings").delete().eq("service_id", serviceId);
  await db.from("service_input_fields").delete().eq("service_id", serviceId);
  await db.from("pricing_audit_log").delete().eq("service_id", serviceId);

  const { error: deleteError } = await db.from("services").delete().eq("id", serviceId);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
