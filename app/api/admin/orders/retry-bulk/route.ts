import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../../lib/security/rate-limit";
import { ReliableSMMAdapter } from "../../../../../lib/fulfillment/reliablesmm/adapter";
import { retryOrderFulfillment, getOrderProviderCostUsd, recoverStuckSubmittingOrders, type RetryResult } from "../../../../../lib/fulfillment/retry-service";

// Maximum items processed per chunk to guarantee finishing well under Vercel Serverless Function 15s limit
const CHUNK_LIMIT = 5;

export async function POST(request: Request) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const rejected = await enforceAdminRateLimit(request, user.id, "bulk-retry", 10);
    if (rejected) return rejected;
  } catch {
    return limiterUnavailable();
  }

  const body = await request.json().catch(() => ({}));
  const cursor = typeof body.cursor === "string" ? body.cursor : null;

  // Recover any stuck submitting orders older than 10 mins
  await recoverStuckSubmittingOrders().catch(() => 0);

  const db = createSupabaseAdminClient();
  const adapter = new ReliableSMMAdapter();

  // 1. Fetch current balance
  let providerBalance: { balance: string; currency: string };
  try {
    providerBalance = await adapter.getBalance();
  } catch (err) {
    return NextResponse.json(
      { error: `Cannot query provider balance: ${err instanceof Error ? err.message : "Network error"}` },
      { status: 502 }
    );
  }

  let remainingBalanceUsd = Number(providerBalance.balance);

  // 2. Fetch chunk of failed orders eligible due to provider funds (oldest first, with keyset cursor)
  // CRITICAL REQUIREMENT: Condition is strictly WHERE fulfillment_status = 'FAILED'
  let query = db
    .from("orders")
    .select("id,public_order_id,service_id,quantity,failure_reason,created_at")
    .eq("payment_status", "PAID")
    .eq("fulfillment_status", "FAILED")
    .eq("failure_reason", "provider_insufficient_funds")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(CHUNK_LIMIT + 1);

  if (cursor) {
    query = query.gt("created_at", cursor);
  }

  const { data: fetchedOrders, error: fetchErr } = await query;

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const hasMore = (fetchedOrders?.length ?? 0) > CHUNK_LIMIT;
  const chunkOrders = (fetchedOrders ?? []).slice(0, CHUNK_LIMIT);

  if (chunkOrders.length === 0) {
    return NextResponse.json({
      message: "No orders with insufficient provider funds pending retry.",
      processed: 0,
      succeeded: 0,
      failed: 0,
      skippedInsufficientBalance: 0,
      hasMore: false,
      nextCursor: null,
      results: [],
    });
  }

  const results: RetryResult[] = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let stoppedDueToBalance = false;

  for (const ord of chunkOrders) {
    // Check if we still have balance for this order
    const { costUsd } = await getOrderProviderCostUsd(ord.id, ord.service_id, ord.quantity, db);

    if (costUsd > 0 && remainingBalanceUsd < costUsd) {
      skipped++;
      stoppedDueToBalance = true;
      results.push({
        orderId: ord.id,
        publicOrderId: ord.public_order_id,
        outcome: "INSUFFICIENT_BALANCE",
        message: `Skipped: order requires $${costUsd.toFixed(2)} USD but remaining balance is $${remainingBalanceUsd.toFixed(2)} USD.`,
      });
      break;
    }

    // Execute retry
    const res = await retryOrderFulfillment({
      orderId: ord.id,
      adminUserId: user.id,
      force: false,
    });

    results.push(res);

    if (res.outcome === "SUCCEEDED") {
      succeeded++;
      remainingBalanceUsd = Math.max(0, remainingBalanceUsd - costUsd);
    } else if (res.outcome === "INSUFFICIENT_BALANCE") {
      skipped++;
      stoppedDueToBalance = true;
      break;
    } else {
      failed++;
    }

    // Small delay between calls to respect rate limits
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const lastOrder = chunkOrders[chunkOrders.length - 1];
  const nextCursor = hasMore && !stoppedDueToBalance && lastOrder ? lastOrder.created_at : null;

  return NextResponse.json({
    message: `Processed chunk of ${results.length} orders: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped.`,
    processed: results.length,
    succeeded,
    failed,
    skippedInsufficientBalance: skipped,
    startingBalanceUsd: Number(providerBalance.balance),
    remainingBalanceUsd,
    hasMore: Boolean(nextCursor),
    nextCursor,
    results,
  });
}
