import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin } from "../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../../lib/security/rate-limit";
import { validateCreateServiceInput } from "../../../../../lib/admin/service-creation";
import {
  matchesApprovedProviderOperation,
  resolveProviderCompatibility,
  resolveProviderPlatformCompatibility,
} from "../../../../../lib/admin/provider-compatibility";
import { assessProviderEligibility } from "../../../../../lib/targets/eligibility";
import { getTargetContractForService } from "../../../../../lib/targets/contracts";
import {
  getDefaultServiceFieldAndMapping,
  getServiceFieldInsertPayload,
  getServiceMappingInsertPayload,
  normalizeFieldDraft,
  normalizeMappingDraft,
} from "../../../../../lib/admin/service-input-config";

export type BulkImportItem = {
  providerServiceId: string;
  platformId: string;
  name: string;
  category: string;
  description: string;
  serviceType: string;
  targetType: string;
  minQuantity: string;
  maxQuantity: string;
  sellingPricePer1000: string;
  currency: string;
};

export type BulkImportResultItem = {
  providerServiceId: string;
  name: string;
  status: "success" | "error";
  serviceId?: string;
  autoProvisioned?: boolean;
  error?: string;
};

const MAX_BULK_ITEMS = 30;

export async function POST(request: Request) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const rejected = await enforceAdminRateLimit(request, user.id, "service-mutation", [5, 60]);
    if (rejected) return rejected;
  } catch {
    return limiterUnavailable();
  }

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "Request body must include an array of items." }, { status: 400 });
  }
  if (body.items.length > MAX_BULK_ITEMS) {
    return NextResponse.json({ error: `Maximum ${MAX_BULK_ITEMS} services per bulk import.` }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  const results: BulkImportResultItem[] = [];

  for (const rawItem of body.items as unknown[]) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      results.push({ providerServiceId: "?", name: "?", status: "error", error: "Invalid item format." });
      continue;
    }
    const item = rawItem as Partial<BulkImportItem>;
    const providerServiceId = typeof item.providerServiceId === "string" ? item.providerServiceId.trim() : "";

    if (!providerServiceId || !/^\d+$/.test(providerServiceId)) {
      results.push({ providerServiceId: providerServiceId || "?", name: item.name || "?", status: "error", error: "A valid numeric provider service ID is required." });
      continue;
    }

    // Validate common service fields
    let input: ReturnType<typeof validateCreateServiceInput>;
    try {
      input = validateCreateServiceInput({
        platformId: item.platformId || "",
        name: item.name || "",
        category: item.category || "",
        description: item.description || "",
        serviceType: item.serviceType || "standard",
        targetType: item.targetType || "url",
        minQuantity: item.minQuantity || "100",
        maxQuantity: item.maxQuantity || "100000",
        sellingPricePer1000: item.sellingPricePer1000 || "",
        currency: item.currency || "GHS",
      });
    } catch (err) {
      results.push({ providerServiceId, name: item.name || "?", status: "error", error: err instanceof Error ? err.message : "Invalid service details." });
      continue;
    }

    // Verify platform
    const { data: platform, error: platformError } = await db
      .from("platforms")
      .select("id,name,slug")
      .eq("id", input.platformId)
      .eq("active", true)
      .maybeSingle();
    if (platformError || !platform) {
      results.push({ providerServiceId, name: input.name, status: "error", error: "Platform not found or inactive." });
      continue;
    }

    // Check for duplicate slug
    const { data: duplicate } = await db
      .from("services")
      .select("id")
      .eq("slug", input.slug)
      .maybeSingle();
    if (duplicate) {
      results.push({ providerServiceId, name: input.name, status: "error", error: "A service with this name/slug already exists." });
      continue;
    }

    // Verify provider catalog entry
    const { data: catalog, error: catalogError } = await db
      .from("provider_catalog_services")
      .select("provider,provider_service_id,name,provider_rate,provider_currency,rate_unit,min_quantity,max_quantity,provider_status,raw_metadata")
      .eq("provider", "reliablesmm")
      .eq("provider_service_id", providerServiceId)
      .maybeSingle();
    if (catalogError || !catalog || catalog.provider_status !== "ACTIVE") {
      results.push({ providerServiceId, name: input.name, status: "error", error: "Provider catalog service not found or inactive." });
      continue;
    }

    // Eligibility check
    const compatibility = resolveProviderCompatibility(catalog.raw_metadata, catalog.name);
    const platformCompatibility = resolveProviderPlatformCompatibility(catalog.raw_metadata, platform, catalog.name);
    const category = typeof (catalog.raw_metadata as { category?: unknown } | null)?.category === "string"
      ? (catalog.raw_metadata as { category: string }).category
      : "";
    const eligibility = assessProviderEligibility({
      serviceSlug: input.slug,
      targetContract: getTargetContractForService({ slug: input.slug, targetType: input.targetType, platformSlug: platform.slug }),
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
    if (eligibility.status !== "ELIGIBLE") {
      results.push({ providerServiceId, name: input.name, status: "error", error: `Provider eligibility failed: ${eligibility.reason}` });
      continue;
    }

    // Check already-mapped
    const { data: existing } = await db
      .from("services")
      .select("slug,name")
      .eq("provider", "reliablesmm")
      .eq("provider_service_id", providerServiceId)
      .maybeSingle();
    if (existing) {
      results.push({ providerServiceId, name: input.name, status: "error", error: `Already mapped to "${existing.name}".` });
      continue;
    }

    // Insert service
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
        active: false,
      })
      .select("id,platform_id,name,slug,target_type,min_quantity,max_quantity,selling_rate,currency,active,provider,provider_service_id")
      .single();
    if (insertError || !service) {
      if (insertError?.code === "23505") {
        results.push({ providerServiceId, name: input.name, status: "error", error: "A service with this name/slug already exists." });
      } else {
        results.push({ providerServiceId, name: input.name, status: "error", error: "Unable to create service record." });
      }
      continue;
    }

    // Apply provider mapping
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
      // Roll back the service insert
      await db.from("services").delete().eq("id", service.id);
      results.push({ providerServiceId, name: input.name, status: "error", error: "Provider mapping could not be confirmed; service rolled back." });
      continue;
    }

    // Auto-provision input field + mapping
    let autoProvisioned = false;
    try {
      const { fieldDraft, mappingDraft } = getDefaultServiceFieldAndMapping({
        targetType: service.target_type,
        platformSlug: platform.slug,
        providerServiceId,
      });

      const normalizedField = normalizeFieldDraft(fieldDraft);
      const fieldInsertPayload = getServiceFieldInsertPayload(normalizedField, service.id);
      const { data: createdField, error: fieldErr } = await db
        .from("service_input_fields")
        .insert(fieldInsertPayload)
        .select("id,key,label,input_type")
        .single();

      if (!fieldErr && createdField && mappingDraft) {
        const normalizedMapping = normalizeMappingDraft(
          {
            ...mappingDraft,
            serviceId: service.id,
            service_input_field_id: createdField.id,
          },
          createdField,
          service.target_type
        );
        const mappingInsertPayload = getServiceMappingInsertPayload(
          normalizedMapping,
          service.id,
          createdField.id
        );
        const { error: mapErr } = await db
          .from("service_provider_input_mappings")
          .insert(mappingInsertPayload);

        if (!mapErr) autoProvisioned = true;
      }
    } catch (provErr) {
      console.warn("Bulk import: auto-provisioning skipped for", providerServiceId, provErr);
    }

    results.push({ providerServiceId, name: input.name, status: "success", serviceId: service.id, autoProvisioned });
  }

  try { revalidateTag("catalog"); } catch { /* best-effort */ }

  const successCount = results.filter((r) => r.status === "success").length;
  const errorCount = results.filter((r) => r.status === "error").length;

  return NextResponse.json({ results, successCount, errorCount }, {
    status: errorCount === results.length ? 400 : 207,
  });
}
