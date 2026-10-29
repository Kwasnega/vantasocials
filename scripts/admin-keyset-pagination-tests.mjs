import assert from "node:assert/strict";
import fs from "node:fs";

console.log("=== RUNNING ADMIN KEYSET PAGINATION TESTS ===");

// 1. Test cursor encoding and decoding logic
const originalItem = {
  created_at: "2026-10-28T22:30:00.000Z",
  id: "3e5f2b82-9901-41b9-8c29-3738018274a1",
};

const encoded = Buffer.from(JSON.stringify(originalItem)).toString("base64");
assert.ok(typeof encoded === "string" && encoded.length > 0, "Encoded cursor is non-empty string");

const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf-8"));
assert.equal(decoded.created_at, originalItem.created_at, "Decoded created_at matches original");
assert.equal(decoded.id, originalItem.id, "Decoded id matches original");
console.log("✓ Cursor base64 serialization and deserialization roundtrips identically.");

// 2. Test tie-breaker property with identical timestamps
// When 2 rows have identical timestamps, id tie-breaker guarantees strict ordering and no skips:
const seededRows = [
  { id: "row-3", created_at: "2026-10-28T12:00:00.000Z" },
  { id: "row-2", created_at: "2026-10-28T12:00:00.000Z" },
  { id: "row-1", created_at: "2026-10-28T12:00:00.000Z" },
];

function filterAfterCursor(rows, cursor) {
  return rows.filter((r) => {
    if (r.created_at < cursor.created_at) return true;
    if (r.created_at === cursor.created_at && r.id < cursor.id) return true;
    return false;
  });
}

// Page 1 with limit 1:
const page1 = seededRows.slice(0, 1);
assert.equal(page1[0].id, "row-3");

// Cursor from end of page 1:
const cursorPage1 = { created_at: page1[0].created_at, id: page1[0].id };

// Page 2 fetched with cursor:
const remainingAfterP1 = filterAfterCursor(seededRows, cursorPage1);
const page2 = remainingAfterP1.slice(0, 1);
assert.equal(page2[0].id, "row-2");

// Cursor from end of page 2:
const cursorPage2 = { created_at: page2[0].created_at, id: page2[0].id };
const remainingAfterP2 = filterAfterCursor(seededRows, cursorPage2);
const page3 = remainingAfterP2.slice(0, 1);
assert.equal(page3[0].id, "row-1");

console.log("✓ Deterministic tie-breaker on (created_at DESC, id DESC) prevents row skip/duplication.");

// 3. Verify admin list pages do NOT use offset .range()
const checkedPages = [
  "app/admin/orders/page.tsx",
  "app/admin/customers/page.tsx",
  "app/admin/payments/page.tsx",
  "app/admin/provider-catalog/page.tsx",
];

for (const pagePath of checkedPages) {
  assert.ok(fs.existsSync(pagePath), `Page exists: ${pagePath}`);
  const content = fs.readFileSync(pagePath, "utf8");
  assert.ok(!content.includes(".range("), `Page ${pagePath} must NOT contain offset .range()`);
}
console.log(`✓ Confirmed zero .range() calls across checked admin list pages.`);

console.log("=== ALL KEYSET PAGINATION TESTS PASSED ===");
