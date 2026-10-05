import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../lib/supabase/server";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../lib/security/rate-limit";
import { providerCatalogMatches } from "../../../../lib/admin/provider-category";
import { assessProviderEligibility } from "../../../../lib/targets/eligibility";
import { getTargetContract } from "../../../../lib/targets/contracts";
import { fetchAllProviderCatalogRows } from "../../../../lib/admin/provider-catalog-query";

export async function GET(request: Request) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  try { const rejected = await enforceAdminRateLimit(request, user.id, "provider-catalog", 10); if (rejected) return rejected; } catch { return limiterUnavailable(); }
  const u = new URL(request.url); const vantaSlug = (u.searchParams.get("vanta_slug") || "").trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(vantaSlug)) return NextResponse.json({ error: "A valid VANTA service is required." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const catalogPromise = fetchAllProviderCatalogRows(async (from, to) => {
    const { data, error } = await db.from("provider_catalog_services").select("provider,provider_service_id,name,provider_rate,provider_currency,rate_unit,min_quantity,max_quantity,refill_supported,cancel_supported,provider_status,last_synced_at,raw_metadata").eq("provider", "reliablesmm").order("provider_service_id").range(from, to);
    if (error) throw error;
    return data ?? [];
  });
  const [{ data: service, error: serviceError }, catalogResult] = await Promise.all([
    db.from("services").select("slug,min_quantity,max_quantity,provider,provider_service_id").eq("slug", vantaSlug).maybeSingle(),
    catalogPromise.then((data) => ({ data, error: null })).catch((error) => ({ data: null, error })),
  ]);
  const catalog = catalogResult.data;
  if (catalogResult.error) return NextResponse.json({ error: "Catalog lookup failed." }, { status: 500 });
  if (serviceError) return NextResponse.json({ error: "VANTA service lookup failed." }, { status: 500 });
  if (!service) return NextResponse.json({ error: "VANTA service not found." }, { status: 404 });
  const targetContract = getTargetContract(service.slug);
  const services = (catalog ?? []).filter((row) => providerCatalogMatches(vantaSlug, row.name, String((row.raw_metadata as { category?: unknown } | null)?.category ?? ""))).map((row) => {
    const eligibility = assessProviderEligibility({ serviceSlug: service.slug, targetContract, vantaMin: service.min_quantity, vantaMax: service.max_quantity, provider: { ...row, provider_service_id: String(row.provider_service_id), name: row.name, provider_status: row.provider_status } });
    return { ...row, description: String((row.raw_metadata as { description?: unknown } | null)?.description ?? row.name), eligibility: eligibility.status, eligibility_reason: eligibility.reason, effective_min: eligibility.effectiveMin ?? null, effective_max: eligibility.effectiveMax ?? null };
  });
  return NextResponse.json({ services, total: services.length, vanta_slug: vantaSlug, target_contract: targetContract, vanta_min: service.min_quantity, vanta_max: service.max_quantity });
}
