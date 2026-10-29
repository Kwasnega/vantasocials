import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../../../lib/admin/auth";
import { ensureProviderMappingEligibility, normalizeMappingDraft } from "../../../../../../../lib/admin/service-input-config";
import { isReservedProviderTransportKey } from "../../../../../../../lib/fulfillment/reliablesmm/reserved-keys";
import { createSupabaseAdminClient } from "../../../../../../../lib/supabase/server";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../../../../lib/security/rate-limit";

const SERVICE_INPUT_MAPPING_SELECT_COLUMNS = "id,service_id,service_input_field_id,provider,provider_service_id,provider_parameter_key,transform_id,transform_version,provider_required,omit_when_blank,schema_version,active,created_at,updated_at";
const SERVICE_INPUT_FIELD_MAPPING_COLUMNS = "id,service_id,key,label,input_type,required,display_order,placeholder,help_text,validation_config,schema_version,active,created_at,updated_at";

export async function PATCH(request: Request, { params }: { params: Promise<{ serviceId: string; mappingId: string }> }) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const rejected = await enforceAdminRateLimit(request, user.id, "service-mapping-mutation", [30, 30]);
    if (rejected) return rejected;
  } catch {
    return limiterUnavailable();
  }
  const { serviceId, mappingId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const { data: current, error: lookupError } = await db.from("service_provider_input_mappings").select(SERVICE_INPUT_MAPPING_SELECT_COLUMNS).eq("service_id", serviceId).eq("id", mappingId).maybeSingle();
  if (lookupError) return NextResponse.json({ error: "Mapping lookup failed." }, { status: 500 });
  if (!current) return NextResponse.json({ error: "Mapping not found for this service." }, { status: 404 });
  const requestedActive = body.active === undefined ? current.active : Boolean(body.active);

  // No-op early return if status is identical and no other fields are changed
  if (requestedActive === current.active) {
    return NextResponse.json({ mapping: current });
  }

  const { data: service, error: serviceError } = await db.from("services").select("id,slug,target_type,min_quantity,max_quantity,platforms(slug,name)").eq("id", serviceId).maybeSingle();
  if (serviceError) return NextResponse.json({ error: "Service lookup failed." }, { status: 500 });
  if (!service) return NextResponse.json({ error: "VANTA service not found." }, { status: 404 });
  const normalizedService = {
    ...service,
    platforms: Array.isArray(service.platforms) ? service.platforms[0] ?? null : service.platforms ?? null,
  };
  if (requestedActive && !current.active) {
    if (isReservedProviderTransportKey(current.provider_parameter_key ?? "") && current.provider_parameter_key !== "link") {
      return NextResponse.json({ error: `Provider parameter key '${current.provider_parameter_key}' is reserved for system-controlled transport fields.` }, { status: 400 });
    }
    const { data: field, error: fieldError } = await db
      .from("service_input_fields")
      .select(SERVICE_INPUT_FIELD_MAPPING_COLUMNS)
      .eq("service_id", serviceId)
      .eq("id", current.service_input_field_id)
      .maybeSingle();
    if (fieldError) return NextResponse.json({ error: "VANTA input field lookup failed." }, { status: 500 });
    if (!field) return NextResponse.json({ error: "The mapping's VANTA input field is unavailable." }, { status: 409 });
    try {
      normalizeMappingDraft({
        ...current,
        serviceId,
        provider: "reliablesmm",
        providerServiceId: current.provider_service_id,
        providerParameterKey: current.provider_parameter_key,
        transformId: current.transform_id,
        transformVersion: current.transform_version,
        providerRequired: current.provider_required,
        omitWhenBlank: current.omit_when_blank,
        schemaVersion: current.schema_version,
        active: true,
      }, field, normalizedService.target_type);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "The input mapping configuration is invalid." }, { status: 409 });
    }
    const { data: catalogRow, error: catalogError } = await db.from("provider_catalog_services").select("provider,provider_service_id,name,provider_status,provider_rate,provider_currency,rate_unit,min_quantity,max_quantity,raw_metadata").eq("provider", "reliablesmm").eq("provider_service_id", current.provider_service_id).eq("provider_status", "ACTIVE").maybeSingle();
    if (catalogError) return NextResponse.json({ error: "Provider catalog lookup failed." }, { status: 500 });
    if (!catalogRow) return NextResponse.json({ error: "The selected ReliableSMM service is unavailable or inactive." }, { status: 409 });
    try {
      ensureProviderMappingEligibility(
        normalizedService,
        catalogRow,
        true,
        current.provider_parameter_key === "link" && current.transform_id === "normalize_url",
      );
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "This provider service is not eligible for the selected VANTA service." }, { status: 409 });
    }
    const { data: applied, error: applyError } = await db.rpc("apply_provider_mapping", {
      p_service_id: serviceId,
      p_provider: "reliablesmm",
      p_provider_service_id: String(current.provider_service_id),
      p_changed_by: user.id,
    });
    const appliedMapping = Array.isArray(applied) ? applied[0] : applied;
    if (applyError || appliedMapping?.service_id !== serviceId || String(appliedMapping?.provider_service_id ?? "") !== String(current.provider_service_id)) {
      return NextResponse.json({ error: applyError?.message || "Provider service mapping did not confirm the selected ReliableSMM service." }, { status: 409 });
    }
    const { error: staleMappingsError } = await db
      .from("service_provider_input_mappings")
      .update({ active: false })
      .eq("service_id", serviceId)
      .eq("provider", "reliablesmm")
      .neq("provider_service_id", String(current.provider_service_id))
      .eq("active", true);
    if (staleMappingsError) return NextResponse.json({ error: "The service now targets this provider service, but older input mappings could not be deactivated. Fulfillment will remain blocked until they are reviewed." }, { status: 500 });
  }
  const { data, error } = await db.from("service_provider_input_mappings").update({ active: requestedActive }).eq("id", mappingId).select(SERVICE_INPUT_MAPPING_SELECT_COLUMNS).single();
  if (error) return NextResponse.json({ error: "Unable to update provider mapping." }, { status: 500 });
  return NextResponse.json({ mapping: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ serviceId: string; mappingId: string }> }) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const rejected = await enforceAdminRateLimit(request, user.id, "service-mapping-delete", [30, 30]);
    if (rejected) return rejected;
  } catch {
    return limiterUnavailable();
  }
  const { serviceId, mappingId } = await params;
  const db = createSupabaseAdminClient();
  const { data: current, error: lookupError } = await db.from("service_provider_input_mappings").select("id,active").eq("service_id", serviceId).eq("id", mappingId).maybeSingle();
  if (lookupError) return NextResponse.json({ error: "Field lookup failed." }, { status: 500 });
  if (!current) return NextResponse.json({ error: "Mapping not found for this service." }, { status: 404 });
  if (!current.active) {
    return NextResponse.json({ mapping: current });
  }
  const { data, error } = await db.from("service_provider_input_mappings").update({ active: false }).eq("service_id", serviceId).eq("id", mappingId).select(SERVICE_INPUT_MAPPING_SELECT_COLUMNS).single();
  if (error) return NextResponse.json({ error: "Unable to deactivate mapping." }, { status: 500 });
  return NextResponse.json({ mapping: data });
}
