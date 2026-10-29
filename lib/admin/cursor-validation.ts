/**
 * Keyset cursor decoding and strict validation.
 * Prevents PostgREST injection and rejects malformed or malicious cursor inputs.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_ORDER_ID_REGEX = /^[A-Z0-9_-]{3,32}$/i;
const NUMERIC_ID_REGEX = /^[0-9]{1,16}$/;
const REFERENCE_REGEX = /^[A-Z0-9_.-]{3,64}$/i;

export type ValidatedCursor<T = string> = {
  createdAt: string;
  id: T;
};

/**
 * Validates that a string is a strict ISO 8601 timestamp.
 * Accepts: YYYY-MM-DDTHH:mm:ss[.mmm]Z  or  YYYY-MM-DDTHH:mm:ss[.mmm]±HH:MM
 *
 * Uses a structural regex rather than a character blocklist so that valid
 * timestamps with dots (e.g. "2026-10-29T10:00:00.000Z") are accepted,
 * while injection fragments like "2026-10-29T10:00:00Z),or(1=1" are
 * rejected because they don't match the pattern.
 */
export function isValidIsoTimestamp(str: unknown): str is string {
  if (typeof str !== "string") return false;
  // Strict structural check — the regex won't match PostgREST injection strings.
  const ISO_REGEX =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
  if (!ISO_REGEX.test(str)) return false;
  const time = Date.parse(str);
  return !Number.isNaN(time);
}

/**
 * Decodes and strictly validates a keyset cursor with a UUID identifier.
 * Returns null if the cursor is absent or fails validation.
 * Throws an Error with 400 status semantics if the cursor is explicitly malformed.
 */
export function parseUuidCursor(rawCursor?: string | null): ValidatedCursor<string> | null {
  if (!rawCursor || typeof rawCursor !== "string" || !rawCursor.trim()) return null;

  let decodedText: string;
  try {
    decodedText = Buffer.from(rawCursor, "base64").toString("utf-8");
  } catch {
    throw new Error("Invalid base64 encoding in cursor");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodedText);
  } catch {
    throw new Error("Invalid JSON structure in cursor");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Cursor payload must be an object");
  }

  const { created_at, id } = parsed as Record<string, unknown>;

  if (!isValidIsoTimestamp(created_at)) {
    throw new Error("Cursor created_at must be a valid ISO timestamp");
  }

  if (typeof id !== "string" || !UUID_REGEX.test(id)) {
    throw new Error("Cursor id must be a valid UUID");
  }

  return { createdAt: created_at, id };
}

/**
 * Decodes and strictly validates a keyset cursor for Orders (using public_order_id).
 */
export function parseOrderCursor(rawCursor?: string | null): ValidatedCursor<string> | null {
  if (!rawCursor || typeof rawCursor !== "string" || !rawCursor.trim()) return null;

  let decodedText: string;
  try {
    decodedText = Buffer.from(rawCursor, "base64").toString("utf-8");
  } catch {
    throw new Error("Invalid base64 encoding in cursor");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodedText);
  } catch {
    throw new Error("Invalid JSON structure in cursor");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Cursor payload must be an object");
  }

  const { created_at, id } = parsed as Record<string, unknown>;

  if (!isValidIsoTimestamp(created_at)) {
    throw new Error("Cursor created_at must be a valid ISO timestamp");
  }

  if (typeof id !== "string" || !PUBLIC_ORDER_ID_REGEX.test(id)) {
    throw new Error("Cursor id must be a valid order identifier");
  }

  return { createdAt: created_at, id };
}

/**
 * Decodes and strictly validates a keyset cursor for Payments (using payment reference).
 */
export function parsePaymentCursor(rawCursor?: string | null): ValidatedCursor<string> | null {
  if (!rawCursor || typeof rawCursor !== "string" || !rawCursor.trim()) return null;

  let decodedText: string;
  try {
    decodedText = Buffer.from(rawCursor, "base64").toString("utf-8");
  } catch {
    throw new Error("Invalid base64 encoding in cursor");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodedText);
  } catch {
    throw new Error("Invalid JSON structure in cursor");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Cursor payload must be an object");
  }

  const { created_at, reference } = parsed as Record<string, unknown>;

  if (!isValidIsoTimestamp(created_at)) {
    throw new Error("Cursor created_at must be a valid ISO timestamp");
  }

  if (typeof reference !== "string" || !REFERENCE_REGEX.test(reference)) {
    throw new Error("Cursor reference must be a valid payment reference");
  }

  return { createdAt: created_at, id: reference };
}

/**
 * Strictly validates a single service ID cursor for Provider Catalog.
 */
export function parseProviderCatalogCursor(rawCursor?: string | null): string | null {
  if (!rawCursor || typeof rawCursor !== "string" || !rawCursor.trim()) return null;
  const trimmed = rawCursor.trim();
  if (!NUMERIC_ID_REGEX.test(trimmed)) {
    throw new Error("Cursor provider_service_id must be a numeric string");
  }
  return trimmed;
}
