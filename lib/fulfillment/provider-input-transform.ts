import { normalizeComments } from "../inputs/comments";
import { sanitizeCustomerInputField } from "../customer/service-contract";
import { resolveTransform } from "../inputs/transforms";
import { RELIABLESMM_RESERVED_TRANSPORT_KEYS, isReservedProviderTransportKey } from "./reliablesmm/reserved-keys";

export type ProviderInputTransformMapping = {
  service_id?: string;
  serviceId?: string;
  service_input_field_id?: string;
  serviceInputFieldId?: string;
  vanta_input_field_key?: string;
  vantaInputFieldKey?: string;
  provider?: string;
  provider_service_id?: string;
  providerServiceId?: string;
  provider_parameter_key?: string;
  providerParameterKey?: string;
  transform_id?: string;
  transformId?: string;
  transform_version?: number;
  transformVersion?: number;
  provider_required?: boolean;
  providerRequired?: boolean;
  omit_when_blank?: boolean;
  omitWhenBlank?: boolean;
  schema_version?: number;
  schemaVersion?: number;
  active?: boolean;
};

export type ProviderInputTransformOrder = {
  orderId?: string;
  serviceId?: string;
  provider?: string;
  providerServiceId?: string;
  inputSchemaVersion?: number;
  inputSchemaSnapshot?: unknown[];
  inputValues?: Record<string, unknown>;
};

export type ProviderInputTransformResult = {
  provider: string;
  providerServiceId: string;
  payload: Record<string, unknown>;
};

const INTERNAL_PROVIDER_METADATA_KEYS = new Set([
  "provider",
  "provider_service_id",
  "providerServiceId",
  "provider_parameter_key",
  "providerParameterKey",
  "transform_id",
  "transformId",
  "transform_version",
  "transformVersion",
  "mapping_id",
  "mappingId",
  "omit_when_blank",
  "omitWhenBlank",
  "provider_required",
  "providerRequired",
]);

const DISALLOWED_CUSTOMER_PROVIDER_KEYS = new Set([
  ...RELIABLESMM_RESERVED_TRANSPORT_KEYS,
  ...INTERNAL_PROVIDER_METADATA_KEYS,
]);

const OMIT = Symbol("omit");

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown, fieldName: string): string {
  if (typeof value !== "string") throw new Error(`${fieldName} is required.`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${fieldName} is required.`);
  return trimmed;
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (typeof value === "number") return Number.isNaN(value);
  return false;
}

function normalizeMappingRecord(row: ProviderInputTransformMapping) {
  const serviceId = normalizeText(row.service_id ?? row.serviceId, "Service ID");
  const provider = normalizeText(row.provider, "Provider");
  const providerServiceId = normalizeText(row.provider_service_id ?? row.providerServiceId, "Provider service ID");
  const providerParameterKey = normalizeText(row.provider_parameter_key ?? row.providerParameterKey, "Provider parameter key");
  const transformId = normalizeText(row.transform_id ?? row.transformId, "Transform ID");
  const transformVersion = Number(row.transform_version ?? row.transformVersion ?? 1);
  if (!Number.isSafeInteger(transformVersion) || transformVersion < 1) throw new Error("Transform version is invalid.");
  const transform = resolveTransform(transformId, transformVersion);
  if (!transform) throw new Error(`Unknown or unsupported transform: ${transformId}@${transformVersion}.`);

  const vantaInputFieldKey = normalizeText(row.vanta_input_field_key ?? row.vantaInputFieldKey, "VANTA field key");
  const active = row.active === undefined ? true : Boolean(row.active);
  const providerRequired = row.provider_required === undefined ? row.providerRequired === true : Boolean(row.provider_required);
  const omitWhenBlank = row.omit_when_blank === undefined ? Boolean(row.omitWhenBlank) : Boolean(row.omit_when_blank);

  return {
    serviceId,
    provider,
    providerServiceId,
    providerParameterKey,
    transformId,
    transformVersion,
    transform,
    vantaInputFieldKey,
    active,
    providerRequired,
    omitWhenBlank,
  };
}

function applyTransformValue(transformId: string, version: number, value: unknown) {
  const transform = resolveTransform(transformId, version);
  if (!transform) throw new Error(`Unknown or unsupported transform: ${transformId}@${version}.`);
  if (transform.id === "identity") return value;
  if (transform.id === "trim") {
    if (typeof value !== "string") throw new Error("Transform expects text.");
    return value.trim();
  }
  if (transform.id === "normalize_url") {
    if (typeof value !== "string") throw new Error("Transform expects text.");
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol)) throw new Error("URL transform requires HTTP(S).");
    url.hash = "";
    return url.toString();
  }
  if (transform.id === "normalize_comments") {
    return normalizeComments(value, { maxLength: 10000, maxLines: 100, maxLineLength: 500 });
  }
  throw new Error(`Unsupported transform: ${transformId}.`);
}

function transformScalarValue(field: { inputType?: string }, transform: { id: string; version: number }, rawValue: unknown) {
  const value = rawValue === undefined || rawValue === null ? "" : rawValue;
  if (isBlank(value)) {
    if (transform.id === "identity" || transform.id === "trim") return "";
    if (transform.id === "normalize_url") return "";
    if (transform.id === "normalize_comments") return { lines: [] };
    return "";
  }
  if (typeof value !== "string") {
    throw new Error(`Field "${field.inputType ?? "value"}" must be text.`);
  }
  return applyTransformValue(transform.id, transform.version, value);
}

export function buildProviderPayload(order: ProviderInputTransformOrder, mappings: ProviderInputTransformMapping[]): ProviderInputTransformResult {
  if (!order || typeof order !== "object") throw new Error("Order snapshot is required.");
  if (!Array.isArray(order.inputSchemaSnapshot) || order.inputSchemaSnapshot.length === 0) {
    throw new Error("The order schema snapshot is missing or invalid.");
  }
  if (!order.inputValues || typeof order.inputValues !== "object" || Array.isArray(order.inputValues)) {
    throw new Error("The order input values are missing or malformed.");
  }

  const serviceId = normalizeText(order.serviceId, "Service ID");
  const orderProvider = normalizeText(order.provider, "Provider");
  const orderProviderServiceId = normalizeText(order.providerServiceId, "Provider service ID");
  const orderId = normalizeText(order.orderId ?? "", "Order ID");

  const keys = Object.keys(order.inputValues);
  for (const key of keys) {
    if (isReservedProviderTransportKey(key) || DISALLOWED_CUSTOMER_PROVIDER_KEYS.has(key)) {
      throw new Error("Customer-supplied provider metadata is rejected.");
    }
  }

  const snapshotFields = order.inputSchemaSnapshot.map((field) => sanitizeCustomerInputField(field));
  const snapshotKeys = new Set(snapshotFields.map((field) => field.key));
  for (const field of snapshotFields) {
    const value = (order.inputValues as Record<string, unknown>)[field.key];
    if (value === undefined || value === null) continue;
    if (field.inputType === "comments" && typeof value !== "string") {
      throw new Error(`Field "${field.key}" must be text.`);
    }
  }

  const extraKeys = Object.keys(order.inputValues).filter((key) => !snapshotKeys.has(key));
  if (extraKeys.length > 0) {
    throw new Error(`Unknown VANTA field in order snapshot: ${extraKeys[0]}`);
  }

  const normalizedMappings = mappings.map((row) => normalizeMappingRecord(row));
  for (const mapping of normalizedMappings) {
    if (mapping.serviceId !== serviceId) {
      throw new Error(`Provider mapping belongs to another service: ${mapping.serviceId}.`);
    }
    if (mapping.provider !== orderProvider) {
      throw new Error(`Provider mismatch: mapping provider ${mapping.provider} does not match the authoritative order provider ${orderProvider}.`);
    }
    if (mapping.providerServiceId !== orderProviderServiceId) {
      throw new Error(`Provider service mismatch: mapping provider service ${mapping.providerServiceId} does not match the authoritative order provider service ${orderProviderServiceId}.`);
    }
  }

  const matchingMappings = normalizedMappings.filter((mapping) => mapping.serviceId === serviceId && mapping.provider === orderProvider && mapping.providerServiceId === orderProviderServiceId);
  if (matchingMappings.length === 0) {
    throw new Error("No active approved provider mapping exists for this service.");
  }

  const byField = new Map<string, typeof matchingMappings[number]>();
  for (const mapping of matchingMappings) {
    if (!mapping.active) throw new Error(`Inactive provider mapping for ${mapping.vantaInputFieldKey}.`);
    if (byField.has(mapping.vantaInputFieldKey)) {
      throw new Error(`Conflicting duplicate active mappings for VANTA field ${mapping.vantaInputFieldKey}.`);
    }
    byField.set(mapping.vantaInputFieldKey, mapping);
  }

  const payload: Record<string, unknown> = { service: orderProviderServiceId };
  for (const field of snapshotFields) {
    const mapping = byField.get(field.key);
    const rawValue = (order.inputValues as Record<string, unknown>)[field.key];

    if (!mapping) {
      if (field.required) {
        throw new Error(`Required VANTA field "${field.key}" is missing an approved provider mapping.`);
      }
      if (!isBlank(rawValue)) {
        throw new Error(`Optional VANTA field "${field.key}" was supplied without an approved provider mapping.`);
      }
      continue;
    }

    if (field.required && isBlank(rawValue)) {
      throw new Error(`Field "${field.key}" is required.`);
    }

    if (isBlank(rawValue)) {
      if (mapping.omitWhenBlank) {
        continue;
      }
      if (field.inputType === "comments") {
        payload[mapping.providerParameterKey] = { lines: [] };
        continue;
      }
      payload[mapping.providerParameterKey] = "";
      continue;
    }

    const transformed = (() => {
      const transform = mapping.transform;
      if (field.inputType === "comments") {
        return applyTransformValue(transform.id, transform.version, rawValue);
      }
      if (typeof rawValue !== "string") {
        throw new Error(`Field "${field.key}" must be text.`);
      }
      const normalized = rawValue.trim();
      if (field.required && normalized.length === 0) {
        throw new Error(`Field "${field.key}" is required.`);
      }
      return applyTransformValue(transform.id, transform.version, normalized);
    })();

    payload[mapping.providerParameterKey] = transformed;
  }

  return {
    provider: orderProvider,
    providerServiceId: orderProviderServiceId,
    payload,
  };
}

export function buildProviderPayloadForOrder(order: ProviderInputTransformOrder, mappings: ProviderInputTransformMapping[]) {
  if (!order || typeof order !== "object") throw new Error("Order snapshot is required.");
  if (!order.orderId) throw new Error("Order ID is required.");
  return buildProviderPayload(order, mappings);
}
