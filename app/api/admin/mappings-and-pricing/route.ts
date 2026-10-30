import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin } from "../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../lib/supabase/server";
import { calculatePricing, type RateUnit } from "../../../../lib/pricing/engine";
import { adminPricePer1000ToUnitRate } from "../../../../lib/pricing/customer-price";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../lib/security/rate-limit";
import { assessProviderEligibility } from "../../../../lib/targets/eligibility";
import { getTargetContractForService } from "../../../../lib/targets/contracts";
import {
  matchesApprovedProviderOperation,
  resolveProviderCompatibility,
  resolveProviderPlatformCompatibility,
} from "../../../../lib/admin/provider-compatibility";

export async function POST(request: Request) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const rejected = await enforceAdminRateLimit(request, user.id, "mapping-mutation", [20, 20]);
    if (rejected) return rejected;
  } catch {
    return limiterUnavailable();
  }

  const body = await request.json().catch(() => null);
  const serviceId = String(body?.service_id || "");
  const providerServiceId = String(body?.provider_service_id || "");
  const sellingPricePer1000 = typeof body?.sellingPricePer1000 === "string" ? body.sellingPricePer1000.trim() : "";

  if (!serviceId || !/^[0-9]+$/.test(providerServiceId)) {
    return NextResponse.json({ error: "A valid provider service and positive customer price are required." }, { status: 400 });
  }
  let sellingRatePerUnit: string;
  try {
    sellingRatePerUnit = adminPricePer1000ToUnitRate(sellingPricePer1000, false);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid customer price per 1,000 units." }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  const [
    { data: service, error: serviceError },
    { data: catalog, error: catalogError },
    { data: setting, error: settingError },
  ] = await Promise.all([
    db
      .from("services")
      .select("id,slug,name,selling_rate,currency,provider,provider_service_id,min_quantity,max_quantity,target_type,platforms(slug,name)")
      .eq("id", serviceId)
      .maybeSingle(),
    db
      .from("provider_catalog_services")
      .select("provider,provider_service_id,name,provider_rate,provider_currency,rate_unit,provider_status,min_quantity,max_quantity,raw_metadata")
      .eq("provider", "reliablesmm")
      .eq("provider_service_id", providerServiceId)
      .eq("provider_status", "ACTIVE")
      .maybeSingle(),
    db.from("pricing_settings").select("fx_rate").eq("key", "USD_GHS").maybeSingle(),
  ]);

  if (serviceError || catalogError || settingError) {
    return NextResponse.json({ error: "Unable to load mapping and pricing data." }, { status: 500 });
  }
  if (!service) return NextResponse.json({ error: "VANTA service not found." }, { status: 404 });
  if (service.currency !== "GHS") return NextResponse.json({ error: `VANTA service currency must be GHS; found ${service.currency || "unset"}.` }, { status: 409 });
  if (!catalog) return NextResponse.json({ error: "Provider service is not active in the catalog." }, { status: 409 });
  if (String(catalog.provider_service_id) !== providerServiceId || catalog.provider !== "reliablesmm") {
    return NextResponse.json({ error: "Provider service identity does not match the requested mapping." }, { status: 409 });
  }

  const targetContract = getTargetContractForService({
    slug: service.slug,
    targetType: service.target_type,
    platformSlug: (service.platforms as { slug?: string } | null)?.slug,
  });
  const compatibility = resolveProviderCompatibility(catalog.raw_metadata, catalog.name);
  const platform = service.platforms as { slug?: string; name?: string } | null;
  const platformCompatibility = resolveProviderPlatformCompatibility(catalog.raw_metadata, platform, catalog.name);
  const category = typeof (catalog.raw_metadata as { category?: unknown } | null)?.category === "string"
    ? (catalog.raw_metadata as { category: string }).category
    : "";

  const eligibility = assessProviderEligibility({
    serviceSlug: service.slug,
    targetContract,
    operationCompatibilityVerified: matchesApprovedProviderOperation(
      service.slug,
      String(catalog.provider_service_id),
      catalog.name,
      category,
    ),
    expectedTargetType: service.target_type,
    providerTargetType: compatibility.compatibility?.targetType,
    platformCompatibilityState: platformCompatibility.state,
    vantaMin: service.min_quantity,
    vantaMax: service.max_quantity,
    provider: {
      ...catalog,
      provider_service_id: String(catalog.provider_service_id),
      name: catalog.name,
      provider_status: catalog.provider_status,
    },
  });

  if (eligibility.status === "BLOCKED") {
    return NextResponse.json({ error: `This provider service cannot be mapped: ${eligibility.reason}` }, { status: 409 });
  }

  const unit = catalog.rate_unit as RateUnit;
  if (catalog.provider_currency !== "USD" || !["PER_1000", "PER_ORDER"].includes(unit)) {
    return NextResponse.json({ error: "Provider pricing unit or currency is unsupported." }, { status: 409 });
  }

  const economics = setting?.fx_rate
    ? calculatePricing({
        providerRate: String(catalog.provider_rate),
        providerRateUnit: unit,
        providerCurrency: "USD",
        fxRate: String(setting.fx_rate),
        sellingPricePerUnit: sellingRatePerUnit,
        sellingCurrency: "GHS",
        quantity: 10000,
      })
    : null;

  const mapped = await db.rpc("apply_provider_mapping", {
    p_service_id: serviceId,
    p_provider: "reliablesmm",
    p_provider_service_id: providerServiceId,
    p_changed_by: user.id,
  });

  if (mapped.error) {
    return NextResponse.json({ error: `Provider mapping failed: ${mapped.error.message}` }, { status: 409 });
  }

  const updated = await db
    .from("services")
    .update({ selling_rate: sellingRatePerUnit })
    .eq("id", serviceId)
    .select("id,slug,selling_rate,currency,provider,provider_service_id")
    .single();

  if (updated.error) {
    return NextResponse.json({ error: `Provider mapping was applied, but VANTA price persistence failed: ${updated.error.message}` }, { status: 500 });
  }

  const audit = await db.from("pricing_audit_log").insert({
    service_id: serviceId,
    field: "selling_price",
    old_value: service.selling_rate,
    new_value: sellingRatePerUnit,
    changed_by: user.id,
  });

  if (audit.error) {
    return NextResponse.json({ error: `VANTA price was saved, but pricing audit failed: ${audit.error.message}` }, { status: 500 });
  }

  try { revalidateTag("catalog"); } catch { /* best-effort revalidation */ }
  return NextResponse.json({
    saved: true,
    mapping: mapped.data,
    service: updated.data,
    sellingPricePer1000,
    economics,
    pricingPreviewUnavailable: economics === null,
    pricingPreviewMessage: economics === null ? "USD → GHS FX is not configured." : null,
  });
}
