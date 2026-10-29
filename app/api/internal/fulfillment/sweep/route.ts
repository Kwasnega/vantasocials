import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";
import { dispatchPaidOrder } from "../../../../../lib/fulfillment/dispatch-paid-order";
import {
  reconcileReliableSMMAttempt,
  syncReliableSMMObservedStatus,
} from "../../../../../lib/fulfillment/reliablesmm/reconcile";

const SWEEP_BATCH_SIZE = 20;

export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization");
  if (!expected || supplied !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const olderThanIso = new Date(Date.now() - 60 * 1000).toISOString();

  // 1. Find PAID orders older than 60s that are unsubmitted and have no active claim
  const { data: stuckOrders, error: stuckError } = await admin
    .from("orders")
    .select("id,public_order_id,fulfillment_status,created_at")
    .eq("payment_status", "PAID")
    .in("fulfillment_status", ["NOT_STARTED", "SUBMITTING"])
    .lte("created_at", olderThanIso)
    .order("created_at", { ascending: true })
    .limit(SWEEP_BATCH_SIZE);

  if (stuckError) {
    return NextResponse.json({ error: "Unable to query pending orders for sweep." }, { status: 500 });
  }

  const dispatchResults: Array<{ orderId: string; publicOrderId: string; outcome: string; reason?: string }> = [];

  for (const order of stuckOrders ?? []) {
    // Check if there is an active unexpired claim
    const { data: claim } = await admin
      .from("fulfillment_order_claims")
      .select("order_id,expires_at,released_at")
      .eq("order_id", order.id)
      .maybeSingle();

    const isClaimActive = claim && !claim.released_at && new Date(claim.expires_at).getTime() > Date.now();
    if (isClaimActive) {
      continue;
    }

    try {
      const result = await dispatchPaidOrder(order.id);
      dispatchResults.push({
        orderId: order.id,
        publicOrderId: order.public_order_id,
        outcome: result.outcome,
        reason: result.reason,
      });
    } catch (err) {
      dispatchResults.push({
        orderId: order.id,
        publicOrderId: order.public_order_id,
        outcome: "ERROR",
        reason: err instanceof Error ? err.message : "Dispatch threw an error",
      });
    }
  }

  // 2. Background reconcile of active provider orders due for poll
  const { data: dueAttempts } = await admin
    .from("provider_orders")
    .select("id,status,attempt_status")
    .eq("provider", "reliablesmm")
    .not("provider_order_id", "is", null)
    .in("attempt_status", ["SUBMITTED", "UNKNOWN_PENDING_RECONCILIATION"])
    .eq("manual_review_state", "NONE")
    .lte("next_poll_at", new Date().toISOString())
    .limit(10);

  const reconcileResults: Array<{ attemptId: string; status: string }> = [];
  for (const attempt of dueAttempts ?? []) {
    try {
      if (["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"].includes(attempt.status)) {
        await syncReliableSMMObservedStatus(attempt.id);
      } else {
        await reconcileReliableSMMAttempt(attempt.id);
      }
      reconcileResults.push({ attemptId: attempt.id, status: "RECONCILED" });
    } catch {
      reconcileResults.push({ attemptId: attempt.id, status: "FAILED" });
    }
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    swept: dispatchResults.length,
    dispatched: dispatchResults,
    reconciled: reconcileResults,
  });
}
