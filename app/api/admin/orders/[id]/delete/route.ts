import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/server";

/**
 * POST /api/admin/orders/[id]/delete
 * Safely deletes an order.
 * - For unpaid orders: hard deletes the order and unlinks/cleans events.
 * - For paid orders: marks as permanently deleted in target_preview without deleting financial transactions.
 * Requires { confirmation: "DELETE" } in request body.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { admin, user } = await requireAdmin();
  if (!admin || !user) {
    return NextResponse.json({ error: "Unauthorized. Admin permissions required." }, { status: 401 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Order ID required" }, { status: 400 });

  let confirmation = "";
  try {
    const body = await req.json();
    confirmation = (body?.confirmation ?? "").trim();
  } catch {
    // optional body
  }

  if (confirmation !== "DELETE") {
    return NextResponse.json({ error: "Confirmation required. Type 'DELETE' to confirm deletion." }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  const { data: order, error: oErr } = await db
    .from("orders")
    .select("id, public_order_id, payment_status, fulfillment_status, total, currency, target_preview")
    .or(`id.eq.${id},public_order_id.eq.${id}`)
    .maybeSingle();

  if (oErr || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Block deleting if fulfillment is actively in submission
  if (["SUBMITTING", "PROCESSING"].includes(order.fulfillment_status)) {
    return NextResponse.json(
      { error: "Order is currently in submission or processing. Wait for fulfillment to settle before deleting." },
      { status: 409 }
    );
  }

  if (order.payment_status === "UNPAID") {
    // Pure unpaid order: can be hard-deleted cleanly
    await db.from("order_events").delete().eq("order_id", order.id);
    const { error: delErr } = await db.from("orders").delete().eq("id", order.id);
    if (delErr) {
      return NextResponse.json({ error: `Failed to delete order: ${delErr.message}` }, { status: 500 });
    }
  } else {
    // Paid order: mark as deleted in snapshot so financial records are never corrupted
    const currentPreview = (order.target_preview && typeof order.target_preview === "object") ? order.target_preview : {};
    const updatedPreview = {
      ...currentPreview,
      _deleted: true,
      _deleted_at: new Date().toISOString(),
      _deleted_by: user.id,
      _deleted_amount: order.total,
    };

    await db
      .from("orders")
      .update({
        target_preview: updatedPreview,
        fulfillment_status: "CANCELLED",
      })
      .eq("id", order.id);
  }

  await db.from("admin_action_log").insert({
    action: "DELETE_ORDER",
    performed_by: user.id,
    details: {
      order_id: order.id,
      public_order_id: order.public_order_id,
      payment_status: order.payment_status,
      amount: order.total,
      currency: order.currency,
    },
    result_summary: { deleted: true },
  });

  return NextResponse.json({ deleted: true, orderId: order.id });
}
