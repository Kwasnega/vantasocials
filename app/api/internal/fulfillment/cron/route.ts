import { NextRequest, NextResponse } from "next/server";

import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";
import { fulfillPaidOrder } from "../../../../../lib/fulfillment/worker";

const BATCH_SIZE = 10;

export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization");
  if (!expected || supplied !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createSupabaseAdminClient();
  const { data: orders, error } = await admin.from("orders").select("id,target_value,quantity,services!inner(slug)").eq("payment_status", "PAID").in("fulfillment_status", ["NOT_STARTED", "FAILED"]).order("created_at", { ascending: true }).limit(BATCH_SIZE);
  if (error) return NextResponse.json({ error: "Unable to load fulfillment jobs." }, { status: 500 });

  const results = [];
  for (const order of orders || []) {
    const service = Array.isArray(order.services) ? order.services[0] : order.services;
    if (!service?.slug) continue;
    const result = await fulfillPaidOrder({ orderId: order.id, vantaSlug: service.slug, targetValue: order.target_value, quantity: order.quantity });
    console.info(JSON.stringify({ event: "fulfillment_job_processed", orderId: order.id, outcome: result.outcome }));
    results.push({ orderId: order.id, outcome: result.outcome });
  }
  return NextResponse.json({ processed: results.length, results });
}
