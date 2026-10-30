import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin } from "../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../lib/supabase/server";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../lib/security/rate-limit";
import { validateCreateServiceInput } from "../../../../lib/admin/service-creation";
import {
  matchesApprovedProviderOperation,
  resolveProviderCompatibility,
  resolveProviderPlatformCompatibility,
} from "../../../../lib/admin/provider-compatibility";
import { assessProviderEligibility } from "../../../../lib/targets/eligibility";
import { getTargetContractForService } from "../../../../lib/targets/contracts";
import {
  getDefaultServiceFieldAndMapping,
  getServiceFieldInsertPayload,
  getServiceMappingInsertPayload,
  normalizeFieldDraft,
  normalizeMappingDraft,
} from "../../../../lib/admin/service-input-config";

export async function POST(request: Request) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const rejected = await enforceAdminRateLimit(request, user.id, "service-mutation", [30, 30]);
    if (rejected) return rejected;
  } catch {
    return limiterUnavailable();
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  let input: ReturnType<typeof validateCreateServiceInput>;
  try {
    input = validateCreateServiceInput(body as Parameters<typeof validateCreateServiceInput>[0]);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid service details." }, { status: 400 });
  }

  const requestedProviderServiceId = Object.prototype.hasOwnProperty.call(body, "providerServiceId");
  const providerServiceId = typeof body.providerServiceId === "string" ? body.providerServiceId.trim() : "";
  if (requestedProviderServiceId && !/^\d+$/.test(providerServiceId)) {
    return NextResponse.json({ error: "A valid ReliableSMM provider service ID is required." }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  const { data: platform, error: platformError } = await db
    .from("platforms")
    .select("id,name,slug")
    .eq("id", input.platformId)
    .eq("active", true)
    .maybeSingle();
  if (platformError) return NextResponse.json({ error: "Unable to verify the selected platform." }, { status: 500 });
  if (!platform) return NextResponse.json({ error: "Platform was not found or is inactive." }, { status: 400 });

  const { data: duplicate, error: duplicateError } = await db
    .from("services")
    .select("id")
    .eq("slug", input.slug)
    .maybeSingle();
  if (duplicateError) return NextResponse.json({ error: "Unable to check for a duplicate service." }, { status: 500 });
  if (duplicate) return NextResponse.json({ error: "A service with this name/slug already exists." }, { status: 409 });

  if (providerServiceId) {
    const { data: catalog, error: catalogError } = await db
      .from("provider_catalog_services")
      .select("provider,provider_service_id,name,provider_rate,provider_currency,rate_unit,min_quantity,max_quantity,provider_status,raw_metadata")
      .eq("provider", "reliablesmm")
      .eq("provider_service_id", providerServiceId)
      .maybeSingle();
    if (catalogError) return NextResponse.json({ error: "Unable to verify the selected provider service." }, { status: 500 });
    if (!catalog || catalog.provider_status !== "ACTIVE") {
      return NextResponse.json({ error: "The selected provider catalog service is no longer active." }, { status: 409 });
    }
    if (catalog.provider !== "reliablesmm" || String(catalog.provider_service_id) !== providerServiceId) {
      return NextResponse.json({ error: "The selected provider service identity does not match the catalog." }, { status: 409 });
    }

    const compatibility = resolveProviderCompatibility(catalog.raw_metadata, catalog.name);
    const platformCompatibility = resolveProviderPlatformCompatibility(catalog.raw_metadata, platform, catalog.name);
    const category = typeof (catalog.raw_metadata as { category?: unknown } | null)?.category === "string"
      ? (catalog.raw_metadata as { category: string }).category
      : "";
    const eligibility = assessProviderEligibility({
      serviceSlug: input.slug,
      targetContract: getTargetContractForService({
        slug: input.slug,
        targetType: input.targetType,
        platformSlug: platform.slug,
      }),
      operationCompatibilityVerified: matchesApprovedProviderOperation(input.slug, providerServiceId, catalog.name, category),
      expectedTargetType: input.targetType,
      providerTargetType: compatibility.compatibility?.targetType,
      platformCompatibilityState: platformCompatibility.state,
      vantaMin: input.minQuantity,
      vantaMax: input.maxQuantity,
      provider: {
        ...catalog,
        provider_service_id: String(catalog.provider_service_id),
        name: catalog.name,
      },
    });
    if (eligibility.status === "BLOCKED") {
      return NextResponse.json({ error: `This provider service cannot be mapped: ${eligibility.reason}` }, { status: 409 });
    }

    const { data: existing, error: existingError } = await db
      .from("services")
      .select("slug,name")
      .eq("provider", "reliablesmm")
      .eq("provider_service_id", providerServiceId)
      .maybeSingle();
    if (existingError) return NextResponse.json({ error: "Unable to check whether the provider service is already mapped." }, { status: 500 });
    if (existing) return NextResponse.json({ error: `This provider service is already mapped to ${existing.name}.` }, { status: 409 });
  }

  const { data: service, error: insertError } = await db
    .from("services")
    .insert({
      platform_id: input.platformId,
      name: input.name,
      slug: input.slug,
      category: input.category,
      description: input.description,
      service_type: input.serviceType,
      target_type: input.targetType,
      min_quantity: input.minQuantity,
      max_quantity: input.maxQuantity,
      selling_rate: input.sellingRatePerUnit,
      currency: input.currency,
      active: true,
    })
    .select("id,platform_id,name,slug,category,description,service_type,target_type,min_quantity,max_quantity,selling_rate,currency,active,provider,provider_service_id")
    .single();
  if (insertError || !service) {
    if (insertError?.code === "23505") return NextResponse.json({ error: "A service with this name/slug already exists." }, { status: 409 });
    return NextResponse.json({ error: "Unable to create service." }, { status: 500 });
  }

  if (!providerServiceId) {
    try { revalidateTag("catalog"); } catch { /* best-effort revalidation */ }
    return NextResponse.json({
      service,
      sellingPricePer1000: input.sellingPricePer1000,
      sellingRateUnit: "GHS_PER_UNIT",
    }, { status: 201 });
  }

  const { data: mapping, error: mappingError } = await db.rpc("apply_provider_mapping", {
    p_service_id: service.id,
    p_provider: "reliablesmm",
    p_provider_service_id: providerServiceId,
    p_changed_by: user.id,
  });
  const mappingResult = Array.isArray(mapping) ? mapping[0] : mapping;
  const mappingConfirmed = !mappingError &&
    mappingResult?.service_id === service.id &&
    mappingResult?.provider === "reliablesmm" &&
    String(mappingResult?.provider_service_id ?? "") === providerServiceId;

  if (!mappingConfirmed) {
    const { error: rollbackError } = await db.from("services").delete().eq("id", service.id);
    const message = mappingError || "The mapping operation did not confirm the requested provider service.";
    return NextResponse.json({
      error: rollbackError
        ? "Provider mapping could not be saved and the new service could not be rolled back. The service remains inactive; verify its mapping before retrying."
        : `Provider mapping could not be saved. ${message instanceof Error ? message.message : String(message)}`,
      serviceId: rollbackError ? service.id : undefined,
    }, { status: 500 });
  }

  const { data: persisted, error: verifyError } = await db
    .from("services")
    .select("id,platform_id,name,slug,category,description,service_type,target_type,min_quantity,max_quantity,selling_rate,currency,active,provider,provider_service_id")
    .eq("id", service.id)
    .maybeSingle();
  if (verifyError || !persisted || persisted.provider !== "reliablesmm" || String(persisted.provider_service_id ?? "") !== providerServiceId) {
    const { error: clearError } = await db
      .from("services")
      .update({
        provider: null,
        provider_service_id: null,
        provider_rate: null,
        provider_rate_unit: null,
        provider_currency: null,
        provider_rate_last_synced: null,
        provider_rate_source: null,
      })
      .eq("id", service.id);
    return NextResponse.json({
      error: clearError
        ? "The provider mapping could not be verified or cleared. The service remains inactive; inspect it before retrying."
        : "The provider mapping could not be verified and was cleared. The service remains inactive and unmapped.",
      serviceId: service.id,
    }, { status: 500 });
  }

  // 1-Click Auto-Provisioning: create standard input field and provider parameter mapping
  // so the service is immediately ready to take orders without manually visiting the inputs page.
  let autoProvisioned = false;
  try {
    const { fieldDraft, mappingDraft } = getDefaultServiceFieldAndMapping({
      targetType: persisted.target_type,
      platformSlug: platform.slug,
      providerServiceId,
    });

    const normalizedField = normalizeFieldDraft(fieldDraft);
    const fieldInsertPayload = getServiceFieldInsertPayload(normalizedField, persisted.id);
    const { data: createdField, error: fieldErr } = await db
      .from("service_input_fields")
      .insert(fieldInsertPayload)
      .select("id,key,label,input_type")
      .single();

    if (!fieldErr && createdField && mappingDraft) {
      const normalizedMapping = normalizeMappingDraft(
        {
          ...mappingDraft,
          serviceId: persisted.id,
          service_input_field_id: createdField.id,
        },
        createdField,
        persisted.target_type
      );
      const mappingInsertPayload = getServiceMappingInsertPayload(
        normalizedMapping,
        persisted.id,
        createdField.id
      );
      const { error: mapErr } = await db
        .from("service_provider_input_mappings")
        .insert(mappingInsertPayload);

      if (!mapErr) {
        autoProvisioned = true;
      }
    }
  } catch (provErr) {
    console.warn("Auto-provisioning input fields skipped or failed:", provErr);
  }

  try { revalidateTag("catalog"); } catch { /* best-effort revalidation */ }
  return NextResponse.json({
    service: persisted,
    mapping: mappingResult,
    autoProvisioned,
    sellingPricePer1000: input.sellingPricePer1000,
    sellingRateUnit: "GHS_PER_UNIT",
  }, { status: 201 });
}
