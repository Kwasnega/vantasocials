import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../lib/supabase/server";
import { derivePricing } from "../../../../lib/admin/pricing";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../lib/security/rate-limit";
import { normalizePricingValue } from "../../../../lib/pricing/engine";

export async function GET(request: Request) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  try { const rejected = await enforceAdminRateLimit(request, user.id, "pricing-read", 30); if (rejected) return rejected; } catch { return limiterUnavailable(); }
  const db = createSupabaseAdminClient();
  const [{ data: services, error: servicesError }, { data: setting, error: settingError }] = await Promise.all([
    db.from("services").select("id,slug,name,selling_rate,currency,provider,provider_service_id,provider_rate,provider_rate_unit,provider_currency,provider_rate_last_synced,min_quantity,max_quantity,active").order("slug"),
    db.from("pricing_settings").select("fx_rate,fx_source,updated_at").eq("key", "USD_GHS").maybeSingle(),
  ]);
  if (servicesError || settingError) return NextResponse.json({ error: "Unable to load pricing data." }, { status: 500 });
  let fxRate: string | null = null;
  let fxError: string | null = null;
  if (setting?.fx_rate != null) {
    try {
      fxRate = normalizePricingValue(setting.fx_rate, false);
    } catch (error) {
      fxError = error instanceof Error ? error.message : "Configured USD → GHS rate is invalid.";
    }
  }
  const fxSource = setting?.fx_source ? String(setting.fx_source) : null;
  const fxUpdatedAt = setting?.updated_at ? String(setting.updated_at) : null;
  return NextResponse.json({
    fxRate,
    fxError,
    fxSource,
    fxUpdatedAt,
    services: (services ?? []).map((service) => ({
      ...service,
      economics: fxRate ? derivePricing(service, fxRate) : null,
    })),
  });
}
