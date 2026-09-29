import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../lib/supabase/server";
export async function POST(request: Request) {
  const { user, admin } = await requireAdmin(); if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 }); if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const body = await request.json().catch(() => null); const serviceId = String(body?.service_id || ""); const provider = String(body?.provider || ""); const providerServiceId = String(body?.provider_service_id || "");
  if (!serviceId || provider !== "reliablesmm" || !/^\d+$/.test(providerServiceId)) return NextResponse.json({ error: "A valid ReliableSMM provider service is required." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc("apply_provider_mapping", { p_service_id: serviceId, p_provider: provider, p_provider_service_id: providerServiceId, p_changed_by: user.id });
  if (error) {
    const message = error.message || "Unable to save mapping.";
    const status = message.includes("not found") ? 404 : message.includes("active") ? 409 : message.includes("authorization") ? 403 : 500;
    return NextResponse.json({ error: status === 404 ? "VANTA or provider service not found." : status === 409 ? "Provider service is not active." : status === 403 ? "Admin access required." : "Unable to save mapping." }, { status });
  }
  return NextResponse.json({ mapped: true, published: false, mapping: Array.isArray(data) ? data[0] ?? null : data });
}
