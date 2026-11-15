import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { admin } = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: customerId } = await params;
  const db = createSupabaseAdminClient();

  const { data: notes, error } = await db
    .from("customer_notes")
    .select(`
      id,
      customer_id,
      order_id,
      author_admin_id,
      category,
      status,
      body,
      created_at,
      resolved_at,
      resolved_by
    `)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ notes: notes || [] });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { admin } = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: customerId } = await params;
  try {
    const body = await request.json();
    const noteText = typeof body.body === "string" ? body.body.trim() : "";
    const category = typeof body.category === "string" ? body.category : "other";
    const orderId = typeof body.order_id === "string" && body.order_id.trim() ? body.order_id.trim() : null;

    if (!noteText) {
      return NextResponse.json({ error: "Note body cannot be empty." }, { status: 400 });
    }

    if (!["complaint", "refund_request", "verification", "other"].includes(category)) {
      return NextResponse.json({ error: "Invalid note category." }, { status: 400 });
    }

    const db = createSupabaseAdminClient();

    // Verify customer exists
    const { data: customer } = await db.from("profiles").select("id").eq("id", customerId).maybeSingle();
    if (!customer) {
      return NextResponse.json({ error: "Customer not found." }, { status: 404 });
    }

    // Verify order if provided
    if (orderId) {
      const { data: order } = await db.from("orders").select("id").eq("id", orderId).eq("user_id", customerId).maybeSingle();
      if (!order) {
        return NextResponse.json({ error: "Linked order not found for this customer." }, { status: 400 });
      }
    }

    const { data: newNote, error: noteErr } = await db
      .from("customer_notes")
      .insert({
        customer_id: customerId,
        order_id: orderId,
        author_admin_id: admin.id,
        category,
        status: "open",
        body: noteText,
      })
      .select()
      .single();

    if (noteErr) throw noteErr;

    // Log admin audit
    await db.from("admin_action_log").insert({
      action: "CUSTOMER_NOTE_CREATED",
      performed_by: admin.id,
      performed_at: new Date().toISOString(),
      details: {
        customer_id: customerId,
        note_id: newNote.id,
        category,
        order_id: orderId,
      },
    });

    return NextResponse.json({ success: true, note: newNote });
  } catch (err) {
    console.error("[API] Customer note create error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
