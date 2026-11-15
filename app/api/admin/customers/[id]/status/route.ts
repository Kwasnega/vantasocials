import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { admin } = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: customerId } = await params;
  if (!customerId) {
    return NextResponse.json({ error: "Customer ID is required" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const newStatus = body.status;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    if (!["ACTIVE", "FLAGGED", "SUSPENDED"].includes(newStatus)) {
      return NextResponse.json({ error: "Invalid status. Must be ACTIVE, FLAGGED, or SUSPENDED." }, { status: 400 });
    }

    if (!reason) {
      return NextResponse.json({ error: "A reason is required to update account status." }, { status: 400 });
    }

    const db = createSupabaseAdminClient();

    // 1. Fetch current profile
    const { data: profile, error: profileErr } = await db
      .from("profiles")
      .select("id,email,account_status")
      .eq("id", customerId)
      .maybeSingle();

    if (profileErr || !profile) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const oldStatus = profile.account_status || "ACTIVE";
    const now = new Date().toISOString();

    // 2. Update profile status
    const { error: updateErr } = await db
      .from("profiles")
      .update({
        account_status: newStatus,
        account_status_reason: reason,
        status_updated_at: now,
        status_updated_by: admin.id,
      })
      .eq("id", customerId);

    if (updateErr) throw updateErr;

    // 3. Write customer status history audit row
    const { error: histErr } = await db.from("customer_status_history").insert({
      customer_id: customerId,
      old_status: oldStatus,
      new_status: newStatus,
      reason,
      changed_by: admin.id,
      created_at: now,
    });

    if (histErr) console.warn("Failed to write customer_status_history:", histErr);

    // 4. Write admin action log
    await db.from("admin_action_log").insert({
      action: `CUSTOMER_STATUS_${newStatus}`,
      performed_by: admin.id,
      performed_at: now,
      details: {
        customer_id: customerId,
        customer_email: profile.email,
        old_status: oldStatus,
        new_status: newStatus,
        reason,
      },
    });

    return NextResponse.json({
      success: true,
      customerId,
      oldStatus,
      newStatus,
      reason,
    });
  } catch (err) {
    console.error("[API] Customer status update error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
