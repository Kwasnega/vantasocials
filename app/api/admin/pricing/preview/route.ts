import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin/auth";
import { calculatePricing, type RateUnit } from "../../../../../lib/pricing/engine";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";

const PREVIEW_QUANTITY = 10000;

export async function GET(request: Request) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const serviceId = params.get("service_id") ?? "";
  const providerServiceId = params.get("provider_service_id") ?? "";
  const sellingPrice = params.get("selling_price") ?? "";
  if (!serviceId || !providerServiceId || !sellingPrice) {
    return NextResponse.json({ error: "Complete pricing inputs are required." }, { status: 400 });
  }
  try {
    const db = createSupabaseAdminClient();
    const [{ data: service }, { data: catalog }, { data: setting }] = await Promise.all([
      db.from("services").select("id,currency").eq("id", serviceId).maybeSingle(),
      db.from("provider_catalog_services").select("provider_service_id,provider_rate,provider_currency,rate_unit,provider_status").eq("provider", "reliablesmm").eq("provider_service_id", providerServiceId).maybeSingle(),
      db.from("pricing_settings").select("fx_rate").eq("key", "USD_GHS").maybeSingle(),
    ]);
    if (!service || service.currency !== "GHS") return NextResponse.json({ error: "VANTA service is unavailable." }, { status: 404 });
    if (!catalog || catalog.provider_status !== "ACTIVE" || catalog.provider_currency !== "USD") return NextResponse.json({ error: "Provider catalog pricing is unavailable." }, { status: 409 });
    const providerRateUnit = catalog.rate_unit as RateUnit;
    if (!["PER_1000", "PER_ORDER"].includes(providerRateUnit)) return NextResponse.json({ error: "Provider pricing basis requires review." }, { status: 409 });
    if (!setting?.fx_rate) return NextResponse.json({ error: "USD → GHS FX is not configured." }, { status: 409 });
    return NextResponse.json(calculatePricing({ providerRate: String(catalog.provider_rate), providerRateUnit, providerCurrency: "USD", fxRate: String(setting.fx_rate), sellingPricePerUnit: sellingPrice, sellingCurrency: "GHS", quantity: PREVIEW_QUANTITY }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid pricing inputs." }, { status: 400 });
  }
}
