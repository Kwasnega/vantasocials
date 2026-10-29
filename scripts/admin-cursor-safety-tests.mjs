import assert from "node:assert/strict";
import {
  parseUuidCursor,
  parseOrderCursor,
  parsePaymentCursor,
  parseProviderCatalogCursor,
  isValidIsoTimestamp,
} from "../lib/admin/cursor-validation.ts";

console.log("=== RUNNING KEYSET CURSOR INJECTION & SAFETY TESTS ===");

// 1. Valid cursor roundtrip
const validIso = "2026-10-29T10:00:00.000Z";
const validUuid = "11111111-2222-3333-4444-555555555555";
const validUuidPayload = Buffer.from(JSON.stringify({ created_at: validIso, id: validUuid })).toString("base64");

const parsedUuid = parseUuidCursor(validUuidPayload);
assert.equal(parsedUuid?.createdAt, validIso);
assert.equal(parsedUuid?.id, validUuid);
console.log("✓ Valid UUID cursor successfully decoded and verified.");

// 2. Reject malicious cursors
const maliciousVectors = [
  // SQL fragment / PostgREST operator injection
  { created_at: "2026-10-29T10:00:00Z),or(1=1", id: validUuid },
  { created_at: validIso, id: "11111111-2222-3333-4444-555555555555,created_at.gte.2020" },
  { created_at: "2026-10-29T10:00:00Z;DROP TABLE orders;--", id: validUuid },
  { created_at: validIso, id: "'; DELETE FROM orders; --" },
  { created_at: "invalid-timestamp", id: validUuid },
  { created_at: validIso, id: "not-a-uuid" },
  { created_at: validIso, id: 12345 },
];

for (const vec of maliciousVectors) {
  const payload = Buffer.from(JSON.stringify(vec)).toString("base64");
  assert.throws(
    () => parseUuidCursor(payload),
    /Cursor (created_at|id)/,
    `Failed to reject malicious vector: ${JSON.stringify(vec)}`
  );
}
console.log(`✓ Rejected all ${maliciousVectors.length} malicious injection attempts for UUID cursors.`);

// 3. Test Order Cursors
const validOrderPayload = Buffer.from(JSON.stringify({ created_at: validIso, id: "VNT-9988AB" })).toString("base64");
const parsedOrder = parseOrderCursor(validOrderPayload);
assert.equal(parsedOrder?.id, "VNT-9988AB");

const maliciousOrderVectors = [
  { created_at: validIso, id: "VNT-1234),public_order_id.is.not.null" },
  { created_at: validIso, id: "VNT-1234;select 1" },
  { created_at: validIso, id: "../../../etc/passwd" },
];
for (const vec of maliciousOrderVectors) {
  const payload = Buffer.from(JSON.stringify(vec)).toString("base64");
  assert.throws(() => parseOrderCursor(payload));
}
console.log("✓ Rejected malicious order cursor vectors.");

// 4. Test Catalog Numeric Cursors
assert.equal(parseProviderCatalogCursor("12345"), "12345");
assert.throws(() => parseProviderCatalogCursor("12345,or(status.eq.ACTIVE)"));
assert.throws(() => parseProviderCatalogCursor("123;delete"));
console.log("✓ Rejected malicious provider catalog cursor vectors.");

console.log("=== ALL KEYSET CURSOR SAFETY TESTS PASSED ===");
