import { VANTA_INPUT_TYPES, type ValidationConfig, type ServiceInputField } from "../inputs/contracts";
import { getInputTypeDefinition } from "../inputs/registry";
import { resolveTransform } from "../inputs/transforms";
import { validateProviderInputMapping, validateServiceInputField } from "../inputs/validation";
import { getTargetContractForService } from "../targets/contracts";
import { assessProviderEligibility } from "../targets/eligibility";
import { assertAllowedProviderParameterKey } from "../fulfillment/reliablesmm/reserved-keys";
import { resolveProviderCompatibility, resolveProviderPlatformCompatibility, sameProviderPlatform } from "./provider-compatibility";

export type NormalizedFieldDraft = ReturnType<typeof validateServiceInputField>;

const isPlainObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function normalizeText(value: unknown, fieldName: string, maxLength = 200) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) throw new Error(`${fieldName} is required.`);
    if (trimmed.length > maxLength) throw new Error(`${fieldName} is too long.`);
    return trimmed;
  }
  throw new Error(`${fieldName} is required.`);
}

export function extractApprovedProviderParameters(rawMetadata: unknown): string[] {
  const metadata = isPlainObject(rawMetadata) ? rawMetadata : null;
  if (!metadata) return [];
  const candidates: unknown[] = [];
  if (Array.isArray(metadata.parameters)) candidates.push(...metadata.parameters);
  if (Array.isArray(metadata.parameter_options)) candidates.push(...metadata.parameter_options);
  if (Array.isArray(metadata.parameterKeys)) candidates.push(...metadata.parameterKeys);
  if (Array.isArray(metadata.parameter_schema)) candidates.push(...metadata.parameter_schema);
  if (Array.isArray(metadata.fields)) candidates.push(...metadata.fields);
  if (metadata.parameter_map && typeof metadata.parameter_map === "object") {
    for (const [key, value] of Object.entries(metadata.parameter_map as Record<string, unknown>)) {
      candidates.push({ key, label: typeof value === "string" ? value : key });
    }
  }
  const seen = new Set<string>();
  const parsed: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const key = candidate.trim();
      if (key && !seen.has(key)) {
        seen.add(key);
        parsed.push(key);
      }
      continue;
    }
    if (isPlainObject(candidate)) {
      const key = (typeof candidate.key === "string" ? candidate.key.trim() : typeof candidate.parameterKey === "string" ? candidate.parameterKey.trim() : typeof candidate.name === "string" ? candidate.name.trim() : "");
      if (key && !seen.has(key)) {
        seen.add(key);
        parsed.push(key);
      }
    }
  }
  return parsed;
}

export function normalizeFieldDraft(raw: unknown) {
  if (!raw || typeof raw !== "object") throw new Error("Field configuration is required.");
  const body = raw as Record<string, unknown>;
  const key = normalizeText(body.key, "Field key", 64).replace(/^_+|_+$/g, "");
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) throw new Error("Field key must be lowercase letters, numbers, or underscores.");
  const label = normalizeText(body.label, "Field label", 120);
  const inputTypeRaw = typeof body.inputType === "string" ? body.inputType : typeof body.input_type === "string" ? body.input_type : "";
  const inputType = inputTypeRaw.trim();
  if (!(VANTA_INPUT_TYPES as readonly string[]).includes(inputType)) throw new Error("Unsupported VANTA input type.");
  const required = body.required === undefined ? true : Boolean(body.required);
  const displayOrder = Number(body.displayOrder ?? body.display_order ?? 0);
  if (!Number.isSafeInteger(displayOrder) || displayOrder < 0) throw new Error("Display order must be a non-negative integer.");
  const placeholder = typeof body.placeholder === "string" ? body.placeholder.trim() : undefined;
  const helpText = typeof body.helpText === "string" ? body.helpText.trim() : typeof body.help_text === "string" ? body.help_text.trim() : undefined;
  const validationConfig = isPlainObject(body.validationConfig) ? body.validationConfig : isPlainObject(body.validation_config) ? body.validation_config : {};
  const schemaVersion = Number(body.schemaVersion ?? body.schema_version ?? 1);
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) throw new Error("Schema version must be a positive integer.");
  const active = body.active === undefined ? true : Boolean(body.active);
  const definition = getInputTypeDefinition(inputType);
  if (!definition) throw new Error("Unsupported VANTA input type.");
  const field: ServiceInputField = {
    key,
    label,
    inputType: inputType as ServiceInputField["inputType"],
    required,
    displayOrder,
    placeholder: placeholder && placeholder.length ? placeholder : undefined,
    helpText: helpText && helpText.length ? helpText : undefined,
    validation: { rule: definition.validationRule, config: validationConfig as ValidationConfig },
    schemaVersion,
    active,
  };
  return validateServiceInputField(field);
}

export function normalizeMappingDraft(raw: unknown, field: ServiceInputField) {
  if (!raw || typeof raw !== "object") throw new Error("Provider mapping configuration is required.");
  const body = raw as Record<string, unknown>;
  const serviceId = normalizeText(body.serviceId ?? body.service_id, "Service ID", 64);
  const provider = normalizeText(body.provider, "Provider", 80);
  const providerServiceId = normalizeText(body.providerServiceId ?? body.provider_service_id, "Provider service ID", 128);
  const providerParameterKey = normalizeText(body.providerParameterKey ?? body.provider_parameter_key, "Provider parameter key", 128);
  assertAllowedProviderParameterKey(providerParameterKey);
  const transformId = normalizeText(body.transformId ?? body.transform_id, "Transform ID", 80);
  const transformVersion = Number(body.transformVersion ?? body.transform_version ?? 1);
  if (!Number.isSafeInteger(transformVersion) || transformVersion < 1) throw new Error("Transform version must be a positive integer.");
  const providerRequired = body.providerRequired === undefined ? false : Boolean(body.providerRequired ?? body.provider_required);
  const omitWhenBlank = body.omitWhenBlank === undefined ? false : Boolean(body.omitWhenBlank ?? body.omit_when_blank);
  const schemaVersion = Number(body.schemaVersion ?? body.schema_version ?? 1);
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) throw new Error("Schema version must be a positive integer.");
  const active = body.active === undefined ? true : Boolean(body.active);
  const transform = resolveTransform(transformId, transformVersion);
  if (!transform) throw new Error("Unknown or unsupported transform.");
  const mapping = {
    serviceId,
    vantaInputFieldKey: field.key,
    provider,
    providerServiceId,
    providerParameterKey,
    transform: { id: transformId, version: transformVersion },
    providerRequired,
    omitWhenBlank,
    mappingSchemaVersion: schemaVersion,
    active,
  };
  return validateProviderInputMapping(mapping, field);
}

export function ensureProviderMappingEligibility(service: { slug: string; target_type?: string | null; min_quantity?: number | null; max_quantity?: number | null; platforms?: { slug?: string | null; name?: string | null } | null }, catalogRow: { provider?: string | null; provider_service_id?: string | number | null; name?: string | null; provider_status?: string | null; provider_currency?: string | null; rate_unit?: string | null; min_quantity?: number | null; max_quantity?: number | null; raw_metadata?: unknown }) {
  const targetContract = getTargetContractForService({
    slug: service.slug,
    targetType: service.target_type ?? null,
    platformSlug: service.platforms?.slug ?? null,
  });
  const compatibility = resolveProviderCompatibility(catalogRow.raw_metadata ?? null);
  const platform = service.platforms ?? null;
  const platformCompatibility = resolveProviderPlatformCompatibility(catalogRow.raw_metadata ?? null, platform);
  const dynamicCompatibilityVerified = Boolean(
    compatibility.compatibility &&
    platform &&
    sameProviderPlatform(compatibility.compatibility.platform, platform) &&
    compatibility.compatibility.targetType === service.target_type,
  );
  const eligibility = assessProviderEligibility({
    serviceSlug: service.slug,
    targetContract,
    dynamicCompatibilityVerified,
    platformCompatibilityState: platformCompatibility.state,
    vantaMin: Number(service.min_quantity ?? 0),
    vantaMax: Number(service.max_quantity ?? 0),
    provider: {
      provider: String(catalogRow.provider ?? "reliablesmm"),
      provider_service_id: String(catalogRow.provider_service_id ?? ""),
      name: String(catalogRow.name ?? ""),
      provider_status: String(catalogRow.provider_status ?? ""),
      provider_currency: String(catalogRow.provider_currency ?? ""),
      rate_unit: String(catalogRow.rate_unit ?? ""),
      min_quantity: Number(catalogRow.min_quantity ?? 0),
      max_quantity: Number(catalogRow.max_quantity ?? 0),
      raw_metadata: catalogRow.raw_metadata,
    },
  });
  if (eligibility.status !== "ELIGIBLE") { throw new Error(eligibility.status === "MANUAL_REVIEW" ? "This provider service requires manual review before mapping." : eligibility.reason); }
  return eligibility;
}

export function getServiceFieldInsertPayload(field: ReturnType<typeof validateServiceInputField>, serviceId: string) {
  return {
    service_id: serviceId,
    key: field.key,
    label: field.label,
    input_type: field.inputType,
    required: field.required,
    display_order: field.displayOrder,
    placeholder: field.placeholder ?? null,
    help_text: field.helpText ?? null,
    validation_config: field.validation.config ?? {},
    schema_version: field.schemaVersion,
    active: field.active,
  };
}

export function getServiceMappingInsertPayload(mapping: ReturnType<typeof validateProviderInputMapping>, serviceId: string, serviceInputFieldId: string) {
  return {
    service_id: serviceId,
    service_input_field_id: serviceInputFieldId,
    provider: mapping.provider,
    provider_service_id: mapping.providerServiceId,
    provider_parameter_key: mapping.providerParameterKey,
    transform_id: mapping.transform.id,
    transform_version: mapping.transform.version,
    provider_required: mapping.providerRequired,
    omit_when_blank: mapping.omitWhenBlank,
    schema_version: mapping.mappingSchemaVersion,
    active: mapping.active,
  };
}
