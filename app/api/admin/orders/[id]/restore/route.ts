import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/server";

/**
 * POST /api/admin/orders/[id]/restore
 * Restores an archived order back to the default queue.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { admin, user } = await requireAdmin();
  if (!admin || !user) {
    return NextResponse.json({ error: "Unauthorized. Admin permissions required." }, { status: 401 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Order ID required" }, { status: 400 });

  const db = createSupabaseAdminClient();
  const { data: order, error: oErr } = await db
    .from("orders")
    .select("id, public_order_id, target_preview")
    .or(`id.eq.${id},public_order_id.eq.${id}`)
    .maybeSingle();

  if (oErr || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const currentPreview = (order.target_preview && typeof order.target_preview === "object") ? { ...order.target_preview } : {};
  delete currentPreview._archived;
  delete currentPreview._archived_at;
  delete currentPreview._archived_by;

  const { error: updateErr } = await db
    .from("orders")
    .update({ target_preview: currentPreview })
    .eq("id", order.id);

  if (updateErr) {
    return NextResponse.json({ error: "Failed to restore order" }, { status: 500 });
  }

  await db.from("admin_action_log").insert({
    action: "RESTORE_ORDER",
    performed_by: user.id,
    details: { order_id: order.id, public_order_id: order.public_order_id },
    result_summary: { restored: true },
  });

  return NextResponse.json({ restored: true, orderId: order.id });
}
