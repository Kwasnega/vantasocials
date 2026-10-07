import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../../lib/security/rate-limit";

export async function PATCH(request: Request) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  try { const rejected = await enforceAdminRateLimit(request, user.id, "pricing-fx-mutation", [20, 20]); if (rejected) return rejected; } catch { return limiterUnavailable(); }
  const body = await request.json().catch(() => null);
  const fxRate = typeof body?.fx_rate === "string" ? body.fx_rate.trim() : "";
  if (!/^\d+(\.\d{1,12})?$/.test(fxRate) || Number(fxRate) <= 0) return NextResponse.json({ error: "fx_rate must be a positive decimal." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const { data: previous } = await db.from("pricing_settings").select("fx_rate").eq("key", "USD_GHS").maybeSingle();
  const { error } = await db.from("pricing_settings").upsert({ key: "USD_GHS", fx_rate: fxRate, fx_source: "MANUAL", updated_by: user.id, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: "Unable to update FX rate." }, { status: 500 });
  const audit = await db.from("pricing_audit_log").insert({ service_id: null, field: "fx_rate", old_value: previous?.fx_rate ?? null, new_value: fxRate, changed_by: user.id });
  if (audit.error) return NextResponse.json({ error: "FX updated, but audit logging failed." }, { status: 500 });
  return NextResponse.json({ fx_rate: fxRate });
}
