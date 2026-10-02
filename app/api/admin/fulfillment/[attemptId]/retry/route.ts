import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/server";

export async function POST(request: Request, { params }: { params: Promise<{ attemptId: string }> }) {
  const { user, admin } = await requireAdmin(); if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 }); if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { attemptId } = await params; if (!/^[0-9a-f-]{36}$/i.test(attemptId)) return NextResponse.json({ error: "Invalid attempt id." }, { status: 400 });
  const db = createSupabaseAdminClient(); const { data: attempt, error } = await db.from("provider_orders").select("id,attempt_status,manual_review_state,order_id,orders!inner(fulfillment_status,payment_status)").eq("id", attemptId).maybeSingle();
  if (error || !attempt) return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
  const order = Array.isArray(attempt.orders) ? attempt.orders[0] : attempt.orders;
  if (attempt.attempt_status !== "FAILED_BEFORE_SUBMISSION" || attempt.manual_review_state !== "NONE" || order?.payment_status !== "PAID" || order?.fulfillment_status !== "SUBMITTING") return NextResponse.json({ error: "Attempt is not safely retryable." }, { status: 409 });
  const result = await db.rpc("create_safe_provider_retry", { p_attempt_id: attemptId }); if (result.error) return NextResponse.json({ error: "Retry unavailable." }, { status: 503 }); if (!result.data) return NextResponse.json({ error: "Retry is not due or retry budget is exhausted." }, { status: 409 });
  return NextResponse.json({ retry_attempt_id: result.data }, { status: 202 });
}
