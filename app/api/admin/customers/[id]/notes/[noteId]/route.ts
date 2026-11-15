import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../../../lib/supabase/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  const { admin } = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: customerId, noteId } = await params;
  try {
    const body = await request.json();
    const status = body.status;

    if (!["open", "resolved"].includes(status)) {
      return NextResponse.json({ error: "Invalid status. Must be open or resolved." }, { status: 400 });
    }

    const db = createSupabaseAdminClient();
    const now = new Date().toISOString();

    const { data: updated, error } = await db
      .from("customer_notes")
      .update({
        status,
        resolved_at: status === "resolved" ? now : null,
        resolved_by: status === "resolved" ? admin.id : null,
      })
      .eq("id", noteId)
      .eq("customer_id", customerId)
      .select()
      .maybeSingle();

    if (error || !updated) {
      return NextResponse.json({ error: error?.message || "Note not found." }, { status: 404 });
    }

    await db.from("admin_action_log").insert({
      action: `CUSTOMER_NOTE_${status.toUpperCase()}`,
      performed_by: admin.id,
      performed_at: now,
      details: { customer_id: customerId, note_id: noteId, status },
    });

    return NextResponse.json({ success: true, note: updated });
  } catch (err) {
    console.error("[API] Note status update error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
