import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";
import { claimOrder, releaseOrderClaim } from "../../../../../lib/fulfillment/claims";
import { fulfillPaidOrder } from "../../../../../lib/fulfillment/worker";
import { resolveProviderForService } from "../../../../../lib/fulfillment/resolver";

export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.PANELS_LIVE_FULFILLMENT_ENABLED !== "true") return NextResponse.json({ error: "Live fulfillment is disabled." }, { status: 423 });
  if (!process.env.RELIABLESMM_API_KEY) return NextResponse.json({ error: "ReliableSMM is not configured." }, { status: 503 });

  let body: { orderId?: unknown };
  try { body = await request.json() as { orderId?: unknown }; } catch { return NextResponse.json({ error: "A valid orderId is required." }, { status: 400 }); }
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return NextResponse.json({ error: "A valid orderId is required." }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const { data: order, error } = await admin.from("orders").select("id,payment_status,fulfillment_status,target_type,target_value,quantity,services!inner(slug)").eq("id", orderId).maybeSingle();
  if (error) return NextResponse.json({ error: "Unable to load the requested order." }, { status: 500 });
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (order.payment_status !== "PAID" || order.fulfillment_status !== "NOT_STARTED") return NextResponse.json({ error: "Order is not eligible for the canary." }, { status: 409 });

  const service = Array.isArray(order.services) ? order.services[0] : order.services;
  const mapping = service?.slug ? await resolveProviderForService(service.slug) : null;
  if (!mapping || mapping.mapping.provider !== "reliablesmm") return NextResponse.json({ error: "The requested order has no approved active ReliableSMM mapping." }, { status: 423 });

  const ownerToken = crypto.randomUUID();
  if (!(await claimOrder(order.id, ownerToken))) return NextResponse.json({ error: "The requested order is already claimed." }, { status: 409 });
  try {
    const result = await fulfillPaidOrder({ orderId: order.id, vantaSlug: service.slug, targetType: order.target_type, targetValue: order.target_value, quantity: order.quantity });
    return NextResponse.json({ orderId: order.id, result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Canary fulfillment failed.", orderId: order.id }, { status: 502 });
  } finally {
    await releaseOrderClaim(order.id, ownerToken);
  }
}
