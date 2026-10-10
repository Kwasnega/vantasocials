import { normalizeComments } from "../inputs/comments";
import { sanitizeCustomerInputField, sanitizeCustomerInputFields, type CustomerInputField, validateCustomerInputValue } from "../customer/service-contract";

export type DynamicOrderValidationResult = {
  schemaVersion: number;
  schemaSnapshot: CustomerInputField[];
  validatedValues: Record<string, unknown>;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function buildDynamicSchemaSnapshot(rows: unknown[]): { schemaVersion: number; schemaSnapshot: CustomerInputField[] } {
  const normalizedRows = Array.isArray(rows) ? rows.filter((row) => isPlainObject(row) && row.active !== false) : [];
  if (normalizedRows.length === 0) {
    return { schemaVersion: 1, schemaSnapshot: [] };
  }

  const schemaVersion = Math.max(...normalizedRows.map((row) => Number((row as Record<string, unknown>).schema_version ?? (row as Record<string, unknown>).schemaVersion ?? 1) || 1), 1);
  const schemaSnapshot = sanitizeCustomerInputFields(normalizedRows);
  if (schemaSnapshot.length !== normalizedRows.length) {
    throw new Error("Service has unsupported or invalid active VANTA field definitions.");
  }

  return { schemaVersion, schemaSnapshot };
}

function normalizeDynamicValue(field: CustomerInputField, rawValue: unknown): unknown {
  if (rawValue === undefined || rawValue === null) return undefined;

  if (field.inputType === "comments") {
    if (typeof rawValue !== "string") {
      throw new Error(`Field "${field.label}" must be text.`);
    }
    const normalized = normalizeComments(rawValue, {
      maxLength: field.validation?.maxLength ?? 10000,
      maxLines: field.validation?.maxLines ?? 100,
      maxLineLength: field.validation?.maxLineLength ?? 500,
    });
    return { lines: normalized.lines };
  }

  if (typeof rawValue !== "string") {
    throw new Error(`Field "${field.label}" must be text.`);
  }

  const result = validateCustomerInputValue(field, rawValue);
  if (!result.isValid) {
    throw new Error(result.error);
  }
  return result.normalized ?? rawValue.trim();
}

export function validateDynamicFieldValues(fields: CustomerInputField[], submitted: unknown): DynamicOrderValidationResult {
  if (!isPlainObject(submitted)) {
    throw new Error("Dynamic input values must be an object keyed by field key.");
  }

  const allowedKeys = new Set(fields.map((field) => field.key));
  const rejectedKeys = Object.keys(submitted).filter((key) => !allowedKeys.has(key));
  if (rejectedKeys.length > 0) {
    throw new Error(`Unknown dynamic field key: ${rejectedKeys[0]}`);
  }

  const validated: Record<string, unknown> = {};
  for (const field of fields) {
    const rawValue = submitted[field.key];
    if (field.required && (rawValue === undefined || rawValue === null || (typeof rawValue === "string" && rawValue.trim() === ""))) {
      throw new Error(`Field "${field.label}" is required.`);
    }
    if (rawValue === undefined || rawValue === null) {
      continue;
    }
    validated[field.key] = normalizeDynamicValue(field, rawValue);
  }

  return {
    schemaVersion: 1,
    schemaSnapshot: fields,
    validatedValues: validated,
  };
}

export async function validateDynamicOrderInput(serviceId: string, submitted: unknown): Promise<DynamicOrderValidationResult> {
  const { createSupabaseAdminClient } = await import("../supabase/server");
  const admin = createSupabaseAdminClient();
  const { data: rows, error } = await admin
    .from("service_input_fields")
    .select("id,key,label,input_type,required,display_order,placeholder,help_text,validation_config,active,schema_version")
    .eq("service_id", serviceId)
    .eq("active", true)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;
  const { schemaVersion, schemaSnapshot } = buildDynamicSchemaSnapshot(rows ?? []);
  if (schemaSnapshot.length === 0) {
    throw new Error("This service does not have active dynamic fields.");
  }

  const result = validateDynamicFieldValues(schemaSnapshot, submitted);
  return {
    schemaVersion,
    schemaSnapshot,
    validatedValues: result.validatedValues,
  };
}
