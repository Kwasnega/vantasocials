import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/server";
import { ReliableSMMReadOnlyClient } from "../../../../../../lib/fulfillment/reliablesmm/client";
import { normalizeReliableSMMCatalog } from "../../../../../../lib/fulfillment/reliablesmm/catalog";
import { enforceAdminRateLimit, limiterUnavailable, acquireProviderLock, releaseProviderLock } from "../../../../../../lib/security/rate-limit";

export async function POST(request: Request) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  try { const rejected = await enforceAdminRateLimit(request, user.id, "provider-catalog-sync", [1, 1]); if (rejected) return rejected; } catch { return limiterUnavailable(); }
  const lockToken = crypto.randomUUID();
  try { if (!(await acquireProviderLock("reliablesmm:catalog-sync", lockToken))) return NextResponse.json({ error: "Provider catalog sync is already running." }, { status: 409 }); } catch { return NextResponse.json({ error: "Provider operation control is unavailable." }, { status: 503 }); }
  const db = createSupabaseAdminClient();
  const { data: run, error: runError } = await db.from("provider_sync_runs").insert({ provider: "reliablesmm", triggered_by: user.id, status: "RUNNING" }).select("id").single();
  if (runError || !run) { await releaseProviderLock("reliablesmm:catalog-sync", lockToken); return NextResponse.json({ error: "Provider sync history is unavailable." }, { status: 500 }); }
  try {
    const raw = await new ReliableSMMReadOnlyClient().getServices();
    const catalog = normalizeReliableSMMCatalog(raw);
    const { data: existing } = await db.from("provider_catalog_services").select("provider_service_id").eq("provider", "reliablesmm");
    const existingIds = new Set((existing ?? []).map((row) => row.provider_service_id));
    const rows = catalog.map((service) => ({ provider: service.provider, provider_service_id: service.providerServiceId, name: service.name, provider_rate: service.providerRate, provider_currency: service.currency, rate_unit: service.pricingUnit === "per_1000" ? "PER_1000" : service.pricingUnit === "per_order" ? "PER_ORDER" : "UNKNOWN", min_quantity: service.minQuantity, max_quantity: service.maxQuantity, refill_supported: service.refill, cancel_supported: service.cancel, provider_status: "ACTIVE", last_synced_at: new Date().toISOString(), raw_metadata: service.rawMetadata }));
    const { error: upsertError } = rows.length ? await db.from("provider_catalog_services").upsert(rows, { onConflict: "provider,provider_service_id", ignoreDuplicates: false }) : { error: null };
    if (upsertError) throw new Error("Catalog persistence failed.");
    const ids = rows.map((row) => row.provider_service_id);
    if (ids.length) await db.from("provider_catalog_services").update({ provider_status: "STALE" }).eq("provider", "reliablesmm").not("provider_service_id", "in", `(${ids.join(",")})`);
    await db.from("provider_sync_runs").update({ status: "SUCCEEDED", completed_at: new Date().toISOString(), imported_count: rows.filter((row) => !existingIds.has(row.provider_service_id)).length, updated_count: rows.filter((row) => existingIds.has(row.provider_service_id)).length }).eq("id", run.id);
    await releaseProviderLock("reliablesmm:catalog-sync", lockToken);
    return NextResponse.json({ provider: "reliablesmm", imported: rows.filter((row) => !existingIds.has(row.provider_service_id)).length, updated: rows.filter((row) => existingIds.has(row.provider_service_id)).length, total: rows.length, published: 0 });
  } catch (error) {
    await db.from("provider_sync_runs").update({ status: "FAILED", completed_at: new Date().toISOString(), error_summary: error instanceof Error ? error.message : "Provider sync failed." }).eq("id", run.id);
    await releaseProviderLock("reliablesmm:catalog-sync", lockToken);
    return NextResponse.json({ error: "Provider catalog sync failed." }, { status: 502 });
  }
}
