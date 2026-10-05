import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../../lib/security/rate-limit";

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  try { const rejected = await enforceAdminRateLimit(request, user.id, "pricing-mutation", [20, 20]); if (rejected) return rejected; } catch { return limiterUnavailable(); }
  const { slug } = await params;
  const body = await request.json().catch(() => null);
  const sellingRate = typeof body?.selling_rate === "string" ? body.selling_rate.trim() : "";
  if (!/^\d+(\.\d{1,6})?$/.test(sellingRate) || Number(sellingRate) < 0) return NextResponse.json({ error: "selling_rate must be a non-negative decimal." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const { data: service, error: readError } = await db.from("services").select("id,selling_rate,currency").eq("slug", slug).maybeSingle();
  if (readError) return NextResponse.json({ error: "Unable to load service." }, { status: 500 });
  if (!service) return NextResponse.json({ error: "Service not found." }, { status: 404 });
  if (body?.currency !== undefined && body.currency !== service.currency) return NextResponse.json({ error: "Selling currency is server-controlled for this service." }, { status: 400 });
  const { error } = await db.from("services").update({ selling_rate: sellingRate }).eq("id", service.id);
  if (error) return NextResponse.json({ error: "Unable to update selling price." }, { status: 500 });
  const audit = await db.from("pricing_audit_log").insert({ service_id: service.id, field: "selling_price", old_value: service.selling_rate, new_value: sellingRate, changed_by: user.id });
  if (audit.error) return NextResponse.json({ error: "Price updated, but audit logging failed." }, { status: 500 });
  return NextResponse.json({ slug, selling_rate: sellingRate, currency: service.currency });
}
