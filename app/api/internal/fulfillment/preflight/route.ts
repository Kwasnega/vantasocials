import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";

function authorized(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && request.headers.get("authorization") === `Bearer ${expected}`);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createSupabaseAdminClient();
  const [{ count: providerOrders }, { data: orderStatuses }, { data: locks }, { data: activeAttempts }, { data: mapping }, { data: catalog }, { data: followersOrder }] = await Promise.all([
    db.from("provider_orders").select("id", { count: "exact", head: true }),
    db.from("provider_orders").select("status,attempt_status"),
    db.from("provider_operation_locks").select("operation_key,acquired_at,expires_at"),
    db.from("provider_orders").select("id,attempt_status,submission_lease_expires_at,reconciliation_lease_expires_at").or("submission_lease_expires_at.not.is.null,reconciliation_lease_expires_at.not.is.null"),
    db.from("services").select("slug,provider,provider_service_id,active").eq("slug", "instagram-views").maybeSingle(),
    db.from("provider_catalog_services").select("provider,provider_service_id,provider_status,provider_rate,provider_currency,rate_unit").eq("provider", "reliablesmm").eq("provider_service_id", "7486").maybeSingle(),
    db.from("orders").select("id,payment_status,fulfillment_status,services!inner(slug,provider,provider_service_id)").eq("services.slug", "instagram-followers").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const statusCounts = (orderStatuses ?? []).reduce<Record<string, number>>((out, row) => {
    const key = `${row.status ?? "UNKNOWN"}/${row.attempt_status ?? "UNKNOWN"}`;
    out[key] = (out[key] ?? 0) + 1;
    return out;
  }, {});
  return NextResponse.json({
    fulfillmentEnabled: process.env.PANELS_LIVE_FULFILLMENT_ENABLED === "true",
    providerOrders: { total: providerOrders ?? 0, statusCounts },
    activeProviderLocks: locks ?? [],
    activeLeases: activeAttempts ?? [],
    canaryMapping: mapping ?? null,
    canaryCatalog: catalog ?? null,
    knownFollowersOrder: followersOrder ? { id: followersOrder.id, payment_status: followersOrder.payment_status, fulfillment_status: followersOrder.fulfillment_status, service: followersOrder.services } : null,
  });
}
