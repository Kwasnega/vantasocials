import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../../lib/admin/auth";
import { ensureProviderMappingEligibility } from "../../../../../../lib/admin/service-input-config";
import { isReservedProviderTransportKey } from "../../../../../../lib/fulfillment/reliablesmm/reserved-keys";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/server";

export async function PATCH(request: Request, { params }: { params: Promise<{ serviceId: string; mappingId: string }> }) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { serviceId, mappingId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const { data: current, error: lookupError } = await db.from("service_provider_input_mappings").select("*").eq("service_id", serviceId).eq("id", mappingId).maybeSingle();
  if (lookupError) return NextResponse.json({ error: "Mapping lookup failed." }, { status: 500 });
  if (!current) return NextResponse.json({ error: "Mapping not found for this service." }, { status: 404 });
  const requestedActive = body.active === undefined ? current.active : Boolean(body.active);
  const { data: service } = await db.from("services").select("id,slug,target_type,min_quantity,max_quantity,platforms(slug,name)").eq("id", serviceId).maybeSingle();
  if (!service) return NextResponse.json({ error: "VANTA service not found." }, { status: 404 });
  if (requestedActive && !current.active) {
    if (isReservedProviderTransportKey(current.provider_parameter_key ?? "")) {
      return NextResponse.json({ error: `Provider parameter key '${current.provider_parameter_key}' is reserved for system-controlled transport fields.` }, { status: 400 });
    }
    const { data: catalogRow } = await db.from("provider_catalog_services").select("provider,provider_service_id,name,provider_status,provider_currency,rate_unit,min_quantity,max_quantity,raw_metadata").eq("provider", "reliablesmm").eq("provider_service_id", current.provider_service_id).eq("provider_status", "ACTIVE").maybeSingle();
    if (!catalogRow) return NextResponse.json({ error: "The selected ReliableSMM service is unavailable or inactive." }, { status: 409 });
    try {
      ensureProviderMappingEligibility(service, catalogRow);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "This provider service is not eligible for the selected VANTA service." }, { status: 409 });
    }
  }
  const { data, error } = await db.from("service_provider_input_mappings").update({ active: requestedActive }).eq("id", mappingId).select("*").single();
  if (error) return NextResponse.json({ error: "Unable to update provider mapping." }, { status: 500 });
  return NextResponse.json({ mapping: data });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ serviceId: string; mappingId: string }> }) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { serviceId, mappingId } = await params;
  const db = createSupabaseAdminClient();
  const { data, error } = await db.from("service_provider_input_mappings").update({ active: false }).eq("service_id", serviceId).eq("id", mappingId).select("*").single();
  if (error) return NextResponse.json({ error: "Unable to deactivate mapping." }, { status: 500 });
  return NextResponse.json({ mapping: data });
}
