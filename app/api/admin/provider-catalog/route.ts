import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../lib/supabase/server";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../lib/security/rate-limit";
import { providerCatalogMatches } from "../../../../lib/admin/provider-category";
import { assessProviderEligibility } from "../../../../lib/targets/eligibility";
import { getTargetContractForService } from "../../../../lib/targets/contracts";
import { fetchAllProviderCatalogRows } from "../../../../lib/admin/provider-catalog-query";
import { resolveProviderCompatibility } from "../../../../lib/admin/provider-compatibility";
import { sameProviderPlatform, resolveProviderPlatformCompatibility } from "../../../../lib/admin/provider-compatibility";

export async function GET(request: Request) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  try { const rejected = await enforceAdminRateLimit(request, user.id, "provider-catalog", 10); if (rejected) return rejected; } catch { return limiterUnavailable(); }
  const u = new URL(request.url); const vantaSlug = (u.searchParams.get("vanta_slug") || "").trim().toLowerCase();
  const db = createSupabaseAdminClient();
  const catalogPromise = fetchAllProviderCatalogRows(async (from, to) => {
    const { data, error } = await db.from("provider_catalog_services").select("provider,provider_service_id,name,provider_rate,provider_currency,rate_unit,min_quantity,max_quantity,refill_supported,cancel_supported,provider_status,last_synced_at,raw_metadata").eq("provider", "reliablesmm").order("provider_service_id").range(from, to);
    if (error) throw error;
    return data ?? [];
  });
  const catalogResult = await catalogPromise.then((data) => ({ data, error: null })).catch((error) => ({ data: null, error }));
  const catalog = catalogResult.data ?? [];
  if (catalogResult.error) return NextResponse.json({ error: "Catalog lookup failed." }, { status: 500 });
  if (!vantaSlug) {
    const search = (u.searchParams.get("q") || "").trim().toLowerCase();
    const status = (u.searchParams.get("status") || "").trim().toUpperCase();
    const rows = catalog.filter((row) => (!search || `${row.name} ${row.provider_service_id}`.toLowerCase().includes(search)) && (!status || row.provider_status === status));
    const { data: mapped } = await db.from("services").select("provider_service_id,slug,name").eq("provider", "reliablesmm");
    const mappedById = new Map((mapped ?? []).map((row) => [String(row.provider_service_id), row]));
    return NextResponse.json({ services: rows.map((row) => { const compatibility = resolveProviderCompatibility(row.raw_metadata); return { ...row, mapped_service: mappedById.get(String(row.provider_service_id)) ?? null, compatibility_state: compatibility.state, compatibility: compatibility.compatibility ?? null, compatibility_reason: compatibility.reason }; }), total: rows.length, mode: "browse" });
  }
  if (!/^[a-z0-9-]+$/.test(vantaSlug)) return NextResponse.json({ error: "A valid VANTA service is required." }, { status: 400 });
  const { data: service, error: serviceError } = await db.from("services").select("slug,min_quantity,max_quantity,provider,provider_service_id,target_type,platforms(slug,name)").eq("slug", vantaSlug).maybeSingle();
  if (serviceError) return NextResponse.json({ error: "VANTA service lookup failed." }, { status: 500 });
  if (!service) return NextResponse.json({ error: "VANTA service not found." }, { status: 404 });
  const targetContract = getTargetContractForService({ slug: service.slug, targetType: service.target_type, platformSlug: (service.platforms as { slug?: string } | null)?.slug });
  const services = (catalog ?? []).filter((row) => providerCatalogMatches(vantaSlug, row.name, String((row.raw_metadata as { category?: unknown } | null)?.category ?? ""))).map((row) => {
    const compatibility = resolveProviderCompatibility(row.raw_metadata); const platform = service.platforms as { slug?: string; name?: string } | null; const platformCompatibility = resolveProviderPlatformCompatibility(row.raw_metadata, platform); const dynamicCompatibilityVerified = Boolean(compatibility.compatibility && platform && sameProviderPlatform(compatibility.compatibility.platform, platform) && compatibility.compatibility.targetType === service.target_type);
    const eligibility = assessProviderEligibility({ serviceSlug: service.slug, targetContract, dynamicCompatibilityVerified, platformCompatibilityState: platformCompatibility.state, vantaMin: service.min_quantity, vantaMax: service.max_quantity, provider: { ...row, provider_service_id: String(row.provider_service_id), name: row.name, provider_status: row.provider_status } });
    return { ...row, description: String((row.raw_metadata as { description?: unknown } | null)?.description ?? row.name), eligibility: eligibility.status, eligibility_reason: eligibility.reason, effective_min: eligibility.effectiveMin ?? null, effective_max: eligibility.effectiveMax ?? null };
  });
  return NextResponse.json({ services, total: services.length, vanta_slug: vantaSlug, target_contract: targetContract, vanta_min: service.min_quantity, vanta_max: service.max_quantity });
}
