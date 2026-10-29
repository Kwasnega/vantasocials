import { NextResponse } from "next/server";

import { getCurrentUser, createSupabaseAdminClient } from "../../../../../../lib/supabase/server";
import { clientIp, consumeRateLimits, limiterUnavailable, rateLimited, rulesFor } from "../../../../../../lib/security/rate-limit";
import {
  reconcileReliableSMMAttempt,
  syncReliableSMMObservedStatus,
} from "../../../../../../lib/fulfillment/reliablesmm/reconcile";

const terminalStatuses = new Set(["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  try {
    const limits = await consumeRateLimits(rulesFor("account-order-status", user.id, clientIp(request), [12, 60]));
    if (!limits.allowed) return rateLimited(limits);
  } catch {
    return limiterUnavailable();
  }

  const { id: publicOrderId } = await params;
  if (!/^VNT-[A-Za-z0-9]{6,12}$/.test(publicOrderId)) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const admin = createSupabaseAdminClient();
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id,quantity,payment_status,fulfillment_status,updated_at")
    .eq("public_order_id", publicOrderId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (orderError) return NextResponse.json({ error: "Unable to load order status." }, { status: 503 });
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  let isCheckingProvider = false;

  if (order.payment_status === "PAID" && !terminalStatuses.has(order.fulfillment_status)) {
    const { data: attempt, error: attemptError } = await admin
      .from("provider_orders")
      .select("id,provider,provider_order_id,status,attempt_status,manual_review_state,next_poll_at")
      .eq("order_id", order.id)
      .eq("provider", "reliablesmm")
      .not("provider_order_id", "is", null)
      .order("attempt_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (attemptError) return NextResponse.json({ error: "Unable to load fulfillment progress." }, { status: 503 });

    if (attempt && terminalStatuses.has(attempt.status)) {
      try {
        await syncReliableSMMObservedStatus(attempt.id);
      } catch {
        return NextResponse.json({ error: "Unable to apply the recorded fulfillment result." }, { status: 503 });
      }
    } else if (
      attempt
      && ["SUBMITTED", "UNKNOWN_PENDING_RECONCILIATION"].includes(attempt.attempt_status)
      && attempt.manual_review_state === "NONE"
      && (!attempt.next_poll_at || new Date(attempt.next_poll_at).getTime() <= Date.now())
    ) {
      isCheckingProvider = true;
      try {
        await reconcileReliableSMMAttempt(attempt.id);
      } catch {
        return NextResponse.json({ error: "Fulfillment status is temporarily unavailable." }, { status: 503 });
      }
    }
  }

  const [
    { data: currentOrder, error: currentOrderError },
    { data: providerStatus },
  ] = await Promise.all([
    admin
      .from("orders")
      .select("payment_status,fulfillment_status,updated_at")
      .eq("id", order.id)
      .eq("user_id", user.id)
      .single(),
    admin
      .from("customer_provider_order_status")
      .select("status,start_count,remains,updated_at")
      .eq("order_id", order.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (currentOrderError || !currentOrder) {
    return NextResponse.json({ error: "Unable to refresh order status." }, { status: 503 });
  }

  const startCount = typeof providerStatus?.start_count === "number" ? providerStatus.start_count : null;
  const remains = typeof providerStatus?.remains === "number" ? providerStatus.remains : null;

  let progressPercent: number | null = null;
  if (currentOrder.fulfillment_status === "COMPLETED") {
    progressPercent = 100;
  } else if (remains !== null && order.quantity > 0) {
    const delivered = Math.max(0, order.quantity - remains);
    progressPercent = Math.min(100, Math.max(0, Math.round((delivered / order.quantity) * 100)));
  }

  return NextResponse.json({
    paymentStatus: currentOrder.payment_status,
    fulfillmentStatus: currentOrder.fulfillment_status,
    startCount,
    remains,
    progressPercent,
    isCheckingProvider,
    lastUpdated: providerStatus?.updated_at ?? currentOrder.updated_at,
  }, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
