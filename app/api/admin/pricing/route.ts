import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../lib/supabase/server";
import { derivePricing } from "../../../../lib/admin/pricing";

export async function GET() {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const db = createSupabaseAdminClient();
  const [{ data: services, error }, { data: setting }] = await Promise.all([
    db.from("services").select("id,slug,name,selling_rate,currency,provider,provider_service_id,provider_rate,provider_rate_unit,provider_currency,provider_rate_last_synced,min_quantity,max_quantity,active").order("slug"),
    db.from("pricing_settings").select("fx_rate").eq("key", "USD_GHS").maybeSingle(),
  ]);
  if (error) return NextResponse.json({ error: "Unable to load pricing." }, { status: 500 });
  const fxRate = setting?.fx_rate ? String(setting.fx_rate) : null;
  return NextResponse.json({ fxRate, services: (services ?? []).map((service) => ({ ...service, economics: fxRate ? derivePricing(service, fxRate) : null })) });
}
