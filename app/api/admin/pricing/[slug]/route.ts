import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin } from "../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../../lib/security/rate-limit";
import { adminPricePer1000ToUnitRate } from "../../../../../lib/pricing/customer-price";

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  try { const rejected = await enforceAdminRateLimit(request, user.id, "pricing-mutation", [20, 20]); if (rejected) return rejected; } catch { return limiterUnavailable(); }
  const { slug } = await params;
  const body = await request.json().catch(() => null);
  const sellingPricePer1000 = typeof body?.sellingPricePer1000 === "string" ? body.sellingPricePer1000.trim() : "";
  let sellingRatePerUnit: string;
  try {
    sellingRatePerUnit = adminPricePer1000ToUnitRate(sellingPricePer1000);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid customer price per 1,000 units." }, { status: 400 });
  }
  const db = createSupabaseAdminClient();
  const { data: service, error: readError } = await db.from("services").select("id,selling_rate,currency").eq("slug", slug).maybeSingle();
  if (readError) return NextResponse.json({ error: "Unable to load service." }, { status: 500 });
  if (!service) return NextResponse.json({ error: "Service not found." }, { status: 404 });
  if (body?.currency !== undefined && body.currency !== service.currency) return NextResponse.json({ error: "Selling currency is server-controlled for this service." }, { status: 400 });

  // No-op check: if the rate matches exactly, return immediately without database update or audit log
  if (String(service.selling_rate) === String(sellingRatePerUnit)) {
    return NextResponse.json({ slug, sellingPricePer1000, selling_rate: sellingRatePerUnit, currency: service.currency });
  }

  const { error } = await db.from("services").update({ selling_rate: sellingRatePerUnit }).eq("id", service.id);
  if (error) return NextResponse.json({ error: "Unable to update selling price." }, { status: 500 });
  const audit = await db.from("pricing_audit_log").insert({ service_id: service.id, field: "selling_price", old_value: service.selling_rate, new_value: sellingRatePerUnit, changed_by: user.id });
  if (audit.error) return NextResponse.json({ error: "Price updated, but audit logging failed." }, { status: 500 });
  try { revalidateTag("catalog"); } catch { /* best-effort revalidation */ }
  return NextResponse.json({ slug, sellingPricePer1000, selling_rate: sellingRatePerUnit, currency: service.currency });
}
