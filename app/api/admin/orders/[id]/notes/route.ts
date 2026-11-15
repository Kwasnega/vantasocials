import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../../lib/admin/auth";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../../../lib/security/rate-limit";
import { recordOrderEvent } from "../../../../../../lib/orders/events";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const rejected = await enforceAdminRateLimit(request, user.id, "order-admin-note", 20);
    if (rejected) return rejected;
  } catch {
    return limiterUnavailable();
  }

  const { id: orderId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
    return NextResponse.json({ error: "Invalid order ID." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!note) {
    return NextResponse.json({ error: "Note text is required." }, { status: 400 });
  }

  const ok = await recordOrderEvent({
    orderId,
    type: "admin_note",
    message: note,
    actor: `admin:${user.id}`,
    meta: { admin_email: user.email },
  });

  if (!ok) {
    return NextResponse.json({ error: "Failed to persist admin note." }, { status: 500 });
  }

  return NextResponse.json({ success: true, message: "Admin note recorded." });
}
