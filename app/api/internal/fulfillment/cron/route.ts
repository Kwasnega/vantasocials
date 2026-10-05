import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";
import { fulfillPaidOrder } from "../../../../../lib/fulfillment/worker";
import { claimOrder, releaseOrderClaim } from "../../../../../lib/fulfillment/claims";

const BATCH_SIZE = 10;

export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization");
  if (!expected || supplied !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createSupabaseAdminClient();
  await admin.rpc("cleanup_rate_limit_buckets", { p_before: new Date().toISOString() });
  // Operational event retention is best-effort and must never block fulfillment.
  try { await admin.rpc("cleanup_provider_order_events", { p_before: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString() }); } catch { /* retention is non-blocking */ }
  const { data: orders, error } = await admin.from("orders").select("id,target_type,target_value,quantity,services!inner(slug)").eq("payment_status", "PAID").eq("fulfillment_status", "NOT_STARTED").order("created_at", { ascending: true }).limit(BATCH_SIZE);
  if (error) return NextResponse.json({ error: "Unable to load fulfillment jobs." }, { status: 500 });

  const results = [];
  for (const order of orders || []) {
    const ownerToken = crypto.randomUUID();
    if (!(await claimOrder(order.id, ownerToken))) continue;
    const service = Array.isArray(order.services) ? order.services[0] : order.services;
    try {
      if (!service?.slug) continue;
      const result = await fulfillPaidOrder({ orderId: order.id, vantaSlug: service.slug, targetType: order.target_type, targetValue: order.target_value, quantity: order.quantity });
      console.info(JSON.stringify({ event: "fulfillment_job_processed", orderId: order.id, outcome: result.outcome }));
      results.push({ orderId: order.id, outcome: result.outcome });
    } catch (error) {
      console.error(JSON.stringify({ event: "fulfillment_job_failed", orderId: order.id, serviceSlug: service?.slug ?? null, error: error instanceof Error ? error.message : "FULFILLMENT_ERROR" }));
      results.push({ orderId: order.id, outcome: "FAILED" });
    } finally { await releaseOrderClaim(order.id, ownerToken); }
  }
  return NextResponse.json({ processed: results.length, results });
}
