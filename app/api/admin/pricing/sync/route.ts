import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";
import { ReliableSMMReadOnlyClient } from "../../../../../lib/fulfillment/reliablesmm/client";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../../lib/security/rate-limit";

export async function POST(request: Request) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  try { const rejected = await enforceAdminRateLimit(request, user.id, "pricing-sync", [1, 1]); if (rejected) return rejected; } catch { return limiterUnavailable(); }
  const catalog = await new ReliableSMMReadOnlyClient().getServices().catch(() => null);
  if (!catalog) return NextResponse.json({ error: "Provider catalog unavailable." }, { status: 502 });
  const provider = catalog.find((service) => String(service.service) === "7486");
  if (!provider) return NextResponse.json({ error: "Approved provider service is unavailable." }, { status: 409 });
  const db = createSupabaseAdminClient();
  const { data: service } = await db.from("services").select("id,provider_rate").eq("slug", "instagram-views").maybeSingle();
  if (!service) return NextResponse.json({ error: "VANTA service not found." }, { status: 404 });
  const rate = String(provider.rate);
  const { error } = await db.from("services").update({ provider: "reliablesmm", provider_service_id: "7486", provider_rate: rate, provider_rate_unit: "PER_1000", provider_currency: "USD", provider_rate_last_synced: new Date().toISOString(), provider_rate_source: "RELIABLESMM_SERVICES" }).eq("id", service.id);
  if (error) return NextResponse.json({ error: "Unable to persist provider economics." }, { status: 500 });
  const audit = await db.from("pricing_audit_log").insert({ service_id: service.id, field: "provider_rate", old_value: service.provider_rate, new_value: rate, changed_by: user.id });
  if (audit.error) return NextResponse.json({ error: "Provider economics saved, but audit logging failed." }, { status: 500 });
  return NextResponse.json({ service_id: service.id, provider: "reliablesmm", provider_service_id: "7486", provider_rate: rate, provider_rate_unit: "PER_1000", provider_currency: "USD" });
}
