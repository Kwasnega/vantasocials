import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";

/**
 * POST /api/admin/orders/bulk
 * Supports bulk "archive" and "delete" up to 100 orders per batch.
 */
export async function POST(req: Request) {
  const { admin, user } = await requireAdmin();
  if (!admin || !user) {
    return NextResponse.json({ error: "Unauthorized. Admin permissions required." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body?.action; // "archive" | "delete"
  const orderIds: string[] = Array.isArray(body?.orderIds) ? body.orderIds : [];
  const confirmation = (body?.confirmation ?? "").trim();

  if (!["archive", "delete"].includes(action)) {
    return NextResponse.json({ error: "Invalid action. Must be 'archive' or 'delete'." }, { status: 400 });
  }

  if (orderIds.length === 0) {
    return NextResponse.json({ error: "No orders selected." }, { status: 400 });
  }

  if (orderIds.length > 100) {
    return NextResponse.json({ error: "Cannot process more than 100 orders per action." }, { status: 400 });
  }

  if (action === "delete" && confirmation !== "DELETE") {
    return NextResponse.json({ error: "Type DELETE to confirm bulk deletion." }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  const { data: orders, error: oErr } = await db
    .from("orders")
    .select("id, public_order_id, payment_status, fulfillment_status, total, target_preview")
    .in("id", orderIds);

  if (oErr || !orders) {
    return NextResponse.json({ error: "Failed to fetch orders." }, { status: 500 });
  }

  let succeeded = 0;
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const order of orders) {
    if (action === "archive") {
      const currentPreview = (order.target_preview && typeof order.target_preview === "object") ? order.target_preview : {};
      const updatedPreview = {
        ...currentPreview,
        _archived: true,
        _archived_at: new Date().toISOString(),
        _archived_by: user.id,
      };

      const { error: updErr } = await db.from("orders").update({ target_preview: updatedPreview }).eq("id", order.id);
      if (updErr) skipped.push({ id: order.id, reason: updErr.message });
      else succeeded++;
    } else if (action === "delete") {
      if (["SUBMITTING", "PROCESSING"].includes(order.fulfillment_status)) {
        skipped.push({ id: order.id, reason: "Order is currently in submission or processing." });
        continue;
      }

      if (order.payment_status === "UNPAID") {
        await db.from("order_events").delete().eq("order_id", order.id);
        const { error: delErr } = await db.from("orders").delete().eq("id", order.id);
        if (delErr) skipped.push({ id: order.id, reason: delErr.message });
        else succeeded++;
      } else {
        const currentPreview = (order.target_preview && typeof order.target_preview === "object") ? order.target_preview : {};
        const updatedPreview = {
          ...currentPreview,
          _deleted: true,
          _deleted_at: new Date().toISOString(),
          _deleted_by: user.id,
        };
        const { error: updErr } = await db
          .from("orders")
          .update({ target_preview: updatedPreview, fulfillment_status: "CANCELLED" })
          .eq("id", order.id);

        if (updErr) skipped.push({ id: order.id, reason: updErr.message });
        else succeeded++;
      }
    }
  }

  await db.from("admin_action_log").insert({
    action: action === "archive" ? "BULK_ARCHIVE_ORDERS" : "BULK_DELETE_ORDERS",
    performed_by: user.id,
    details: { action, requested_count: orderIds.length, succeeded, skipped },
    result_summary: { succeeded, skipped_count: skipped.length },
  });

  return NextResponse.json({ succeeded, skipped });
}
