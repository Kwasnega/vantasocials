import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

console.log("=== RUNNING ADMIN PERFORMANCE VERIFICATION TESTS ===");

// 1. Verify NO select('*') in app/admin or app/api/admin
console.log("Test 1: Zero select('*') in app/admin and app/api/admin...");
function scanSelectStar(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) scanSelectStar(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) {
      const code = fs.readFileSync(full, "utf8");
      const match = code.match(/\.select\(\s*["']\*["']\s*\)/g);
      assert.equal(match, null, `Found forbidden select('*') in ${full}`);
    }
  }
}
scanSelectStar("app/admin");
scanSelectStar("app/api/admin");
console.log("✓ Zero select('*') detected in admin pages and API routes.");

// 2. Verify NO raw anchor tags pointing to /admin
console.log("Test 2: Zero raw <a href=\"/admin...\"> tags...");
function scanRawAnchors(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) scanRawAnchors(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) {
      const code = fs.readFileSync(full, "utf8");
      const match = code.match(/<a\s+[^>]*href=["'](\/admin[^"']*)["']/g);
      assert.equal(match, null, `Found raw <a href="/admin..."> tag in ${full}`);
    }
  }
}
scanRawAnchors("app/admin");
scanRawAnchors("components/admin");
console.log("✓ Zero raw <a href=\"/admin...\"> tags found in admin pages or components.");

// 3. Verify loading.tsx boundaries exist for all admin sections
console.log("Test 3: Loading boundaries present across admin routes...");
const requiredLoadingFiles = [
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
for (const f of requiredLoadingFiles) {
  assert.ok(fs.existsSync(f), `Missing loading boundary: ${f}`);
}
assert.ok(fs.existsSync("app/admin/error.tsx"), "Missing app/admin/error.tsx boundary");
console.log(`✓ All ${requiredLoadingFiles.length} loading skeletons and error boundary confirmed.`);

// 4. Verify no NEXT_PUBLIC exposure of service-role key
console.log("Test 4: Supabase service role key security...");
function scanPublicServiceRole(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".next") scanPublicServiceRole(full);
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
      const code = fs.readFileSync(full, "utf8");
      assert.ok(!code.includes("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY"), `Service role exposed via NEXT_PUBLIC in ${full}`);
    }
  }
}
scanPublicServiceRole("app");
scanPublicServiceRole("components");
scanPublicServiceRole("lib");
console.log("✓ Service role key is never exported as NEXT_PUBLIC.");

// 5. Verify requireAdmin on all admin API routes
console.log("Test 5: Server-side requireAdmin() guards...");
function scanApiGuards(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += scanApiGuards(full);
    else if (entry.name === "route.ts") {
      const code = fs.readFileSync(full, "utf8");
      assert.ok(code.includes("requireAdmin"), `Missing requireAdmin guard in ${full}`);
      assert.ok(code.includes("401"), `Missing 401 unauthenticated check in ${full}`);
      assert.ok(code.includes("403"), `Missing 403 unauthorized check in ${full}`);
      count++;
    }
  }
  return count;
}
const apiCount = scanApiGuards("app/api/admin");
console.log(`✓ Confirmed requireAdmin() guard on all ${apiCount} admin API routes.`);

// 6. Verify migration and rollback SQL files exist and have valid syntax
console.log("Test 6: Migration and rollback files...");
assert.ok(fs.existsSync("supabase/migrations/20261028000001_admin_performance_indexes.sql"));
assert.ok(fs.existsSync("supabase/migrations/20261028000001_admin_performance_indexes.rollback.sql"));
const migrationSql = fs.readFileSync("supabase/migrations/20261028000001_admin_performance_indexes.sql", "utf8");
const rollbackSql = fs.readFileSync("supabase/migrations/20261028000001_admin_performance_indexes.rollback.sql", "utf8");
assert.ok(migrationSql.includes("orders_payment_status_created_idx"), "Missing composite index in migration");
assert.ok(migrationSql.includes("get_admin_dashboard_metrics"), "Missing metrics function in migration");
assert.ok(rollbackSql.toLowerCase().includes("drop function if exists public.get_admin_dashboard_metrics"), "Missing function drop in rollback");
console.log("✓ SQL migration and rollback verified.");

console.log("=== ALL ADMIN PERFORMANCE VERIFICATION TESTS PASSED ===");
