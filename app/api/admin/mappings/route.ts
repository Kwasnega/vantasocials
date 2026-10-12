import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../lib/supabase/server";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../lib/security/rate-limit";
import { matchesApprovedProviderOperation, resolveProviderCompatibility, resolveProviderPlatformCompatibility } from "../../../../lib/admin/provider-compatibility";
import { assessProviderEligibility } from "../../../../lib/targets/eligibility";
import { getTargetContractForService } from "../../../../lib/targets/contracts";

export async function POST(request: Request) {
  const { user, admin } = await requireAdmin(); if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 }); if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  try { const rejected = await enforceAdminRateLimit(request, user.id, "mapping-mutation", [10, 10]); if (rejected) return rejected; } catch { return limiterUnavailable(); }
  const body = await request.json().catch(() => null); const serviceId = String(body?.service_id || ""); const provider = String(body?.provider || ""); const providerServiceId = String(body?.provider_service_id || "");
  if (!serviceId || provider !== "reliablesmm" || !/^\d+$/.test(providerServiceId)) return NextResponse.json({ error: "A valid ReliableSMM provider service is required." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const [{ data: service, error: serviceError }, { data: catalog, error: catalogError }] = await Promise.all([
    db.from("services").select("id,slug,target_type,min_quantity,max_quantity,platforms(slug,name)").eq("id", serviceId).maybeSingle(),
    db.from("provider_catalog_services").select("provider,provider_service_id,name,provider_rate,provider_currency,rate_unit,min_quantity,max_quantity,provider_status,raw_metadata").eq("provider", provider).eq("provider_service_id", providerServiceId).maybeSingle(),
  ]);
  if (serviceError || catalogError) return NextResponse.json({ error: "Unable to verify provider mapping compatibility." }, { status: 500 });
  if (!service) return NextResponse.json({ error: "VANTA service not found." }, { status: 404 });
  if (!catalog || String(catalog.provider_service_id) !== providerServiceId || catalog.provider !== provider) {
    return NextResponse.json({ error: "Provider service identity was not found." }, { status: 404 });
  }
  const platform = Array.isArray(service.platforms) ? service.platforms[0] ?? null : service.platforms;
  const compatibility = resolveProviderCompatibility(catalog.raw_metadata, catalog.name);
  const platformCompatibility = resolveProviderPlatformCompatibility(catalog.raw_metadata, platform, catalog.name);
  const category = typeof (catalog.raw_metadata as { category?: unknown } | null)?.category === "string"
    ? (catalog.raw_metadata as { category: string }).category
    : "";
  const eligibility = assessProviderEligibility({
    serviceSlug: service.slug,
    targetContract: getTargetContractForService({
      slug: service.slug,
      targetType: service.target_type,
      platformSlug: platform?.slug,
    }),
    operationCompatibilityVerified: matchesApprovedProviderOperation(service.slug, providerServiceId, catalog.name, category),
    expectedTargetType: service.target_type,
    providerTargetType: compatibility.compatibility?.targetType,
    platformCompatibilityState: platformCompatibility.state,
    vantaMin: service.min_quantity,
    vantaMax: service.max_quantity,
    provider: {
      provider: catalog.provider,
      provider_service_id: String(catalog.provider_service_id),
      name: catalog.name,
      provider_status: catalog.provider_status,
      provider_rate: catalog.provider_rate,
      provider_currency: catalog.provider_currency,
      rate_unit: catalog.rate_unit,
      min_quantity: catalog.min_quantity,
      max_quantity: catalog.max_quantity,
      raw_metadata: catalog.raw_metadata,
    },
  });
  if (eligibility.status !== "ELIGIBLE") {
    return NextResponse.json({ error: `This provider service cannot be mapped: ${eligibility.reason}` }, { status: 409 });
  }
  const { data, error } = await db.rpc("apply_provider_mapping", { p_service_id: serviceId, p_provider: provider, p_provider_service_id: providerServiceId, p_changed_by: user.id });
  if (error) {
    const message = error.message || "Unable to save mapping.";
    const status = message.includes("not found") ? 404 : message.includes("active") ? 409 : message.includes("authorization") ? 403 : 500;
    return NextResponse.json({ error: status === 404 ? "VANTA or provider service not found." : status === 409 ? "Provider service is not active." : status === 403 ? "Admin access required." : "Unable to save mapping." }, { status });
  }
  return NextResponse.json({ mapped: true, published: false, mapping: Array.isArray(data) ? data[0] ?? null : data });
}
