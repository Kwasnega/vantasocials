import { normalizeComments } from "../inputs/comments";
import type { ServiceInputField, VantaInputType, ValidationConfig } from "../inputs/contracts";
import { getInputTypeDefinition } from "../inputs/registry";
import { validateServiceInputField } from "../inputs/validation";

export type CatalogService = {
  id: string;
  platform_id: string;
  name: string;
  slug: string;
  category: string;
  description: string | null;
  service_type: string;
  target_type: string;
  min_quantity: number;
  max_quantity: number;
  selling_rate: string;
  currency: string;
  active: boolean;
};

export type CustomerInputField = {
  key: string;
  label: string;
  inputType: VantaInputType;
  required: boolean;
  displayOrder: number;
  placeholder?: string;
  helpText?: string;
  validation?: {
    maxLength?: number;
    maxLines?: number;
    maxLineLength?: number;
  };
};

export type CustomerService = CatalogService & { inputFields: CustomerInputField[] };

const disallowedFieldKeys = new Set([
  "provider",
  "provider_service_id",
  "provider_parameter_key",
  "provider_required",
  "omit_when_blank",
  "transform_id",
  "transform_version",
  "mapping_id",
  "raw_metadata",
  "provider_status",
  "provider_currency",
  "rate_unit",
  "provider_rate",
  "provider_cost",
  "metadata",
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function toCustomerValidation(config: ValidationConfig | undefined): CustomerInputField["validation"] | undefined {
  if (!config) return undefined;
  const next: NonNullable<CustomerInputField["validation"]> = {};
  if (typeof config.maxLength === "number") next.maxLength = config.maxLength;
  if (typeof config.maxLines === "number") next.maxLines = config.maxLines;
  if (typeof config.maxLineLength === "number") next.maxLineLength = config.maxLineLength;
  return Object.keys(next).length ? next : undefined;
}

export function sanitizeCustomerInputField(raw: unknown): CustomerInputField {
  if (!raw || typeof raw !== "object") throw new Error("Field configuration is required.");
  const body = raw as Record<string, unknown>;
  for (const forbidden of disallowedFieldKeys) {
    if (Object.prototype.hasOwnProperty.call(body, forbidden)) {
      throw new Error("Provider-only metadata is not allowed in the customer contract.");
    }
  }
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const inputType = typeof body.inputType === "string" ? body.inputType : typeof body.input_type === "string" ? body.input_type : "";
  const required = typeof body.required === "boolean" ? body.required : Boolean(body.required);
  const displayOrder = Number(body.displayOrder ?? body.display_order ?? 0);
  const placeholder = typeof body.placeholder === "string" ? body.placeholder.trim() || undefined : undefined;
  const helpText = typeof body.helpText === "string" ? body.helpText.trim() || undefined : typeof body.help_text === "string" ? body.help_text.trim() || undefined : undefined;
  const active = body.active === undefined ? true : Boolean(body.active);
  if (!active) throw new Error("Inactive fields are not exposed to customers.");
  const validationSource = isPlainObject(body.validation) && isPlainObject((body.validation as Record<string, unknown>).config) ? (body.validation as Record<string, unknown>).config : isPlainObject(body.validation_config) ? body.validation_config : {};
  const definition = getInputTypeDefinition(inputType);
  if (!definition || !key || !label || !Number.isSafeInteger(displayOrder) || displayOrder < 0) {
    throw new Error("Invalid VANTA field definition.");
  }

  const normalized = validateServiceInputField({
    key,
    label,
    inputType: inputType as ServiceInputField["inputType"],
    required,
    displayOrder,
    placeholder,
    helpText,
    validation: { rule: definition.validationRule, config: validationSource as ValidationConfig },
    schemaVersion: Number(body.schemaVersion ?? body.schema_version ?? 1),
    active,
  });

  return {
    key: normalized.key,
    label: normalized.label,
    inputType: normalized.inputType,
    required: normalized.required,
    displayOrder: normalized.displayOrder,
    ...(normalized.placeholder ? { placeholder: normalized.placeholder } : {}),
    ...(normalized.helpText ? { helpText: normalized.helpText } : {}),
    ...(normalized.validation.config ? { validation: toCustomerValidation(normalized.validation.config) } : {}),
  };
}

export function sanitizeCustomerInputFields(rawFields: unknown[]): CustomerInputField[] {
  const sanitized: CustomerInputField[] = [];
  const seen = new Set<string>();
  for (const row of rawFields) {
    if (!isPlainObject(row) || row.active === false) continue;
    try {
      const field = sanitizeCustomerInputField(row);
      if (seen.has(field.key)) throw new Error("Duplicate VANTA input field keys are not allowed.");
      seen.add(field.key);
      sanitized.push(field);
    } catch {
      continue;
    }
  }
  return sanitized.sort((left, right) => left.displayOrder - right.displayOrder);
}

export function getFieldControlType(inputType: string): "text" | "url" | "textarea" {
  switch (inputType) {
    case "url":
    case "post_url":
    case "video_url":
      return "url";
    case "comments":
      return "textarea";
    default:
      return "text";
  }
}

export function validateCustomerInputValue(field: CustomerInputField, value: unknown): { isValid: boolean; error: string; normalized?: string } {
  const text = typeof value === "string" ? value : "";
  const trimmed = text.trim();
  if (field.required && trimmed.length === 0) return { isValid: false, error: "This field is required." };
  if (!field.required && trimmed.length === 0) return { isValid: true, error: "", normalized: "" };

  const maxLength = field.validation?.maxLength;
  if (typeof maxLength === "number" && trimmed.length > maxLength) {
    return { isValid: false, error: `This field must be ${maxLength} characters or fewer.` };
  }

  if (field.inputType === "comments") {
    try {
      normalizeComments(trimmed, {
        maxLength: field.validation?.maxLength ?? 10000,
        maxLines: field.validation?.maxLines ?? 100,
        maxLineLength: field.validation?.maxLineLength ?? 500,
      });
      return { isValid: true, error: "", normalized: trimmed };
    } catch (error) {
      return { isValid: false, error: error instanceof Error ? error.message : "Comments are invalid." };
    }
  }

  if (["url", "post_url", "video_url"].includes(field.inputType)) {
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Unsupported protocol.");
      return { isValid: true, error: "", normalized: trimmed };
    } catch {
      return { isValid: false, error: "Enter a valid URL." };
    }
  }

  return { isValid: true, error: "", normalized: trimmed };
