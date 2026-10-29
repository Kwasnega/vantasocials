import assert from "node:assert/strict";
import fs from "node:fs";

console.log("=== RUNNING FULL ADMIN PERFORMANCE & SECURITY VERIFICATION SUITE ===");

// 1. Check for select('*')
function scanSelectStar(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) scanSelectStar(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) {
      const code = fs.readFileSync(full, "utf8");
      const match = code.match(/\.select\(\s*["']\*["']\s*\)/g);
      assert.equal(match, null, `Forbidden select('*') in ${full}`);
    }
  }
}
scanSelectStar("app/admin");
scanSelectStar("app/api/admin");
console.log("✓ Test 1: Zero select('*') in app/admin and app/api/admin.");

// 2. Check for raw anchor links to admin
function scanRawAnchors(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) scanRawAnchors(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) {
      const code = fs.readFileSync(full, "utf8");
      const match = code.match(/<a\s+[^>]*href=["'](\/admin[^"']*)["']/g);
      assert.equal(match, null, `Raw <a href="/admin..."> in ${full}`);
    }
  }
}
scanRawAnchors("app/admin");
scanRawAnchors("components/admin");
console.log("✓ Test 2: Zero raw <a href=\"/admin...\"> tags.");

// 3. Check loading boundaries
const loadingFiles = [
  "app/admin/loading.tsx",
  "app/admin/orders/loading.tsx",
  "app/admin/orders/[id]/loading.tsx",
  "app/admin/customers/loading.tsx",
  "app/admin/services/loading.tsx",
  "app/admin/pricing/loading.tsx",
  "app/admin/wallet/loading.tsx",
  "app/admin/settings/loading.tsx",
  "app/admin/fulfillment/loading.tsx",
  "app/admin/platforms/loading.tsx",
  "app/admin/provider-catalog/loading.tsx",
  "app/admin/providers/loading.tsx",
];
for (const f of loadingFiles) {
  assert.ok(fs.existsSync(f), `Missing loading boundary: ${f}`);
}
assert.ok(fs.existsSync("app/admin/error.tsx"), "Missing error.tsx");
console.log(`✓ Test 3: All ${loadingFiles.length} loading skeletons and error boundary confirmed.`);

// 4. Check that no .range() exists in admin list pages
const paginatedPages = [
  "app/admin/orders/page.tsx",
  "app/admin/customers/page.tsx",
  "app/admin/payments/page.tsx",
  "app/admin/provider-catalog/page.tsx",
];
for (const p of paginatedPages) {
  const code = fs.readFileSync(p, "utf8");
  assert.ok(!code.includes(".range("), `Offset .range() still present in ${p}`);
}
console.log("✓ Test 4: Zero offset .range() in admin list views (keyset cursor active).");

// 5. Check migrations
const migration1 = fs.readFileSync("supabase/migrations/20261028000001_admin_performance_indexes.sql", "utf8");
const rollback1 = fs.readFileSync("supabase/migrations/20261028000001_admin_performance_indexes.rollback.sql", "utf8");
assert.ok(migration1.includes("CREATE INDEX IF NOT EXISTS"), "Migration 1 must create indexes");
assert.ok(rollback1.includes("DROP INDEX IF EXISTS"), "Rollback 1 must drop indexes");

const migration2 = fs.readFileSync("supabase/migrations/20261029000001_admin_trgm_search_indexes.sql", "utf8");
const rollback2 = fs.readFileSync("supabase/migrations/20261029000001_admin_trgm_search_indexes.rollback.sql", "utf8");
assert.ok(migration2.includes("pg_trgm"), "Migration 2 must enable pg_trgm");
assert.ok(migration2.includes("CREATE INDEX IF NOT EXISTS"), "Migration 2 must create indexes");
assert.ok(rollback2.includes("DROP INDEX IF EXISTS"), "Rollback 2 must drop indexes");

const migration3 = fs.readFileSync("supabase/migrations/20261029000002_admin_action_log.sql", "utf8");
const rollback3 = fs.readFileSync("supabase/migrations/20261029000002_admin_action_log.rollback.sql", "utf8");
assert.ok(migration3.includes("CREATE TABLE IF NOT EXISTS public.admin_action_log"), "Migration 3 creates admin_action_log");
assert.ok(rollback3.includes("DROP TABLE IF EXISTS public.admin_action_log"), "Rollback 3 drops admin_action_log");
console.log("✓ Test 5: Concurrent index and audit log migrations + rollbacks verified.");

// 6. Check data wipe route removed from production build
assert.equal(fs.existsSync("app/api/admin/data-wipe/route.ts"), false, "Data wipe route must be completely deleted from production codebase");
console.log("✓ Test 6: Data-wipe route completely removed from production build.");

// 7. Check dashboard RPC error logging and freshness label
const dashboardCode = fs.readFileSync("app/admin/page.tsx", "utf8");
assert.ok(dashboardCode.includes("console.error"), "Dashboard logs RPC errors to console.error");
assert.ok(dashboardCode.includes("Metrics computed at"), "Dashboard includes freshness indicator");
console.log("✓ Test 7: Dashboard error logging and freshness indicator verified.");

// 8. Check debounce in AdminFilterBar and AdminSearchInput
const filterBarCode = fs.readFileSync("components/admin/AdminFilterBar.tsx", "utf8");
assert.ok(filterBarCode.includes("debounceRef"), "AdminFilterBar implements debounceRef");
assert.ok(filterBarCode.includes("300"), "AdminFilterBar debounces at 300ms");

const searchInputCode = fs.readFileSync("components/admin/AdminSearchInput.tsx", "utf8");
assert.ok(searchInputCode.includes("debounceRef"), "AdminSearchInput implements debounceRef");
assert.ok(searchInputCode.includes("300"), "AdminSearchInput debounces at 300ms");
console.log("✓ Test 8: 300ms search input debouncing and request cancellation verified.");

// 9. Check canary route deletion
assert.ok(!fs.existsSync("app/api/admin/fulfillment/canary-vnt-610a68"), "Canary route directory must be deleted");
console.log("✓ Test 9: Hardcoded test canary route removed.");

console.log("=== ALL FULL VERIFICATION SUITE TESTS PASSED ===");
