import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../../lib/admin/auth";
import { ensureProviderMappingEligibility, extractApprovedProviderParameters, getServiceMappingInsertPayload, normalizeMappingDraft } from "../../../../../../lib/admin/service-input-config";
import { isReservedProviderTransportKey } from "../../../../../../lib/fulfillment/reliablesmm/reserved-keys";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ serviceId: string }> }) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { serviceId } = await params;
  const db = createSupabaseAdminClient();
  const [{ data: mappings }, { data: catalog }, { data: fields }] = await Promise.all([
    db.from("service_provider_input_mappings").select("*").eq("service_id", serviceId).order("created_at", { ascending: false }),
    db.from("provider_catalog_services").select("provider,provider_service_id,name,provider_status,raw_metadata").eq("provider", "reliablesmm").eq("provider_status", "ACTIVE").order("provider_service_id"),
    db.from("service_input_fields").select("id,key,label,input_type").eq("service_id", serviceId).order("display_order", { ascending: true }),
  ]);
  return NextResponse.json({
    mappings: mappings ?? [],
    fields: fields ?? [],
    providerCatalog: (catalog ?? []).map((row) => ({
      ...row,
      parameterKeys: extractApprovedProviderParameters(row.raw_metadata),
    })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ serviceId: string }> }) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { serviceId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const { data: service } = await db.from("services").select("id,slug,target_type,min_quantity,max_quantity,platforms(slug,name)").eq("id", serviceId).maybeSingle();
  if (!service) return NextResponse.json({ error: "VANTA service not found." }, { status: 404 });
  const normalizedService = {
    ...service,
    platforms: Array.isArray(service.platforms) ? service.platforms[0] ?? null : service.platforms ?? null,
  };
  const fieldId = typeof body.serviceInputFieldId === "string" ? body.serviceInputFieldId : typeof body.service_input_field_id === "string" ? body.service_input_field_id : "";
  if (!fieldId) return NextResponse.json({ error: "A VANTA input field is required." }, { status: 400 });
  const { data: field } = await db.from("service_input_fields").select("*").eq("service_id", serviceId).eq("id", fieldId).maybeSingle();
  if (!field) return NextResponse.json({ error: "This VANTA field does not belong to the selected service." }, { status: 409 });
  const catalogServiceId = typeof body.providerServiceId === "string" ? body.providerServiceId : typeof body.provider_service_id === "string" ? body.provider_service_id : "";
  if (!catalogServiceId) return NextResponse.json({ error: "A ReliableSMM service is required." }, { status: 400 });
  const { data: catalogRow } = await db.from("provider_catalog_services").select("provider,provider_service_id,name,provider_status,provider_currency,rate_unit,min_quantity,max_quantity,raw_metadata").eq("provider", "reliablesmm").eq("provider_service_id", catalogServiceId).eq("provider_status", "ACTIVE").maybeSingle();
  if (!catalogRow) return NextResponse.json({ error: "The selected ReliableSMM service is unavailable or inactive." }, { status: 409 });
  try {
    ensureProviderMappingEligibility(normalizedService, catalogRow);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "This provider service is not eligible for the selected VANTA service." }, { status: 409 });
  }
  const allowedParameters = extractApprovedProviderParameters(catalogRow.raw_metadata);
  const providerParameterKey = typeof body.providerParameterKey === "string" ? body.providerParameterKey : typeof body.provider_parameter_key === "string" ? body.provider_parameter_key : "";
  if (isReservedProviderTransportKey(providerParameterKey)) {
    return NextResponse.json({ error: `Provider parameter key '${providerParameterKey}' is reserved for system-controlled transport fields.` }, { status: 400 });
  }
  if (!allowedParameters.length || !allowedParameters.includes(providerParameterKey)) return NextResponse.json({ error: "Provider parameter metadata is unavailable or the selected parameter is not approved for this catalog entry." }, { status: 409 });

  try {
    const mapping = normalizeMappingDraft(
      {
        ...body,
        serviceId,
        service_input_field_id: fieldId,
        provider: "reliablesmm",
        providerServiceId: catalogServiceId,
        providerParameterKey,
      },
      field,
    );

    const { data: existingActive } = await db.from("service_provider_input_mappings").select("id").eq("service_id", serviceId).eq("service_input_field_id", fieldId).eq("provider", "reliablesmm").eq("provider_service_id", catalogServiceId).eq("schema_version", mapping.mappingSchemaVersion).eq("active", true).maybeSingle();
    if (existingActive) return NextResponse.json({ error: "An active mapping already exists for this VANTA field and provider service." }, { status: 409 });

    const payload = getServiceMappingInsertPayload(mapping, serviceId, fieldId);
    const { data, error } = await db.from("service_provider_input_mappings").insert(payload).select("*").single();
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "An active mapping already exists for this VANTA field and provider service." }, { status: 409 });
      throw error;
    }
    return NextResponse.json({ mapping: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create provider mapping." }, { status: 400 });
  }
}
