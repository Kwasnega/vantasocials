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
  const { data: orders, error } = await admin
    .from("orders")
    .select("id,target_type,target_value,quantity,total,service_id,payment_status,fulfillment_status,input_schema_version,input_schema_snapshot,input_values,services!inner(id,slug,provider,provider_service_id)")
    .eq("payment_status", "PAID")
    .eq("fulfillment_status", "NOT_STARTED")
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);
  if (error) return NextResponse.json({ error: "Unable to load fulfillment jobs." }, { status: 500 });

  const distinctServiceIds = Array.from(new Set((orders || []).map((o) => o.service_id).filter(Boolean)));
  const mappingsByServiceId = new Map<string, any[]>();
  if (distinctServiceIds.length > 0) {
    const { data: batchMappings, error: mappingsError } = await admin
      .from("service_provider_input_mappings")
      .select("service_id,provider,provider_service_id,provider_parameter_key,transform_id,transform_version,provider_required,omit_when_blank,schema_version,active,vanta_input_field_key")
      .in("service_id", distinctServiceIds)
      .eq("active", true)
      .order("created_at", { ascending: true });
    if (!mappingsError && Array.isArray(batchMappings)) {
      for (const mapping of batchMappings) {
        const list = mappingsByServiceId.get(mapping.service_id) ?? [];
        list.push(mapping);
        mappingsByServiceId.set(mapping.service_id, list);
      }
    }
  }

  const results = [];
  for (const order of orders || []) {
    const ownerToken = crypto.randomUUID();
    if (!(await claimOrder(order.id, ownerToken))) continue;
    const service = Array.isArray(order.services) ? order.services[0] : order.services;
    try {
      if (!service?.slug) continue;
      const prefetchedMappings = mappingsByServiceId.get(order.service_id) ?? null;
      const result = await fulfillPaidOrder({
        orderId: order.id,
        vantaSlug: service.slug,
        targetType: order.target_type,
        targetValue: order.target_value,
        quantity: order.quantity,
        prefetchedOrder: order,
        prefetchedMappings,
      });
      if (!result) {
        console.info(JSON.stringify({ event: "fulfillment_job_skipped", orderId: order.id, serviceSlug: service.slug, outcome: null, reason: "fulfillPaidOrder returned null" }));
        results.push({ orderId: order.id, outcome: null });
        continue;
      }
      const outcome = "outcome" in result ? result.outcome : typeof result.status === "string" ? result.status : typeof result.attempt_status === "string" ? result.attempt_status : "UNKNOWN";
      console.info(JSON.stringify({ event: "fulfillment_job_processed", orderId: order.id, outcome }));
      results.push({ orderId: order.id, outcome });
    } catch (error) {
      console.error(JSON.stringify({ event: "fulfillment_job_failed", orderId: order.id, serviceSlug: service?.slug ?? null, error: error instanceof Error ? error.message : "FULFILLMENT_ERROR" }));
      results.push({ orderId: order.id, outcome: "FAILED" });
    } finally { await releaseOrderClaim(order.id, ownerToken); }
  }
  return NextResponse.json({ processed: results.length, results });
}
