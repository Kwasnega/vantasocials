import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/server";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../../../lib/security/rate-limit";
import { reconcileReliableSMMAttempt } from "../../../../../../lib/fulfillment/reliablesmm/reconcile";
import { recordOrderEvent } from "../../../../../../lib/orders/events";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const rejected = await enforceAdminRateLimit(request, user.id, "order-refresh-provider", 20);
    if (rejected) return rejected;
  } catch {
    return limiterUnavailable();
  }

  const { id: orderId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
    return NextResponse.json({ error: "Invalid order ID." }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  const { data: attempt } = await db
    .from("provider_orders")
    .select("id,provider_order_id,status")
    .eq("order_id", orderId)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!attempt || !attempt.provider_order_id) {
    return NextResponse.json({ error: "No provider order found to refresh." }, { status: 404 });
  }

  const res = await reconcileReliableSMMAttempt(attempt.id);

  await recordOrderEvent({
    orderId,
    type: "status_synced",
    message: `Provider status refreshed manually by admin (${user.email}): ${res.outcome}`,
    actor: `admin:${user.id}`,
    meta: { result: res },
  });

  return NextResponse.json({ success: true, result: res });
}
