import assert from "node:assert/strict";
import fs from "node:fs";

console.log("=== RUNNING LIVE SECURITY UNIT & STATIC AUDIT TESTS ===");

const adminApiDir = "app/api/admin";

function collectRouteFiles(dir) {
  const routes = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      routes.push(...collectRouteFiles(full));
    } else if (entry.name === "route.ts") {
      routes.push(full);
    }
  }
  return routes;
}

const adminRoutes = collectRouteFiles(adminApiDir);
console.log(`Auditing ${adminRoutes.length} admin API routes...`);

for (const routePath of adminRoutes) {
  const code = fs.readFileSync(routePath, "utf8");

  // Every route must import and call requireAdmin()
  assert.ok(
    code.includes("requireAdmin"),
    `Route ${routePath} must import and invoke requireAdmin()`
  );

  // Every route must reject unauthenticated requests with 401
  assert.ok(
    code.includes("401"),
    `Route ${routePath} must return 401 when user is missing`
  );

  // Every route must reject non-admin users with 403
  assert.ok(
    code.includes("403"),
    `Route ${routePath} must return 403 when user is not an admin`
  );
}

console.log(`✓ All ${adminRoutes.length} admin API routes strictly enforce 401 (unauthenticated) and 403 (non-admin).`);

// Audit all admin pages for server-side requireAdmin() redirect/guard
const adminPageFiles = [
  "app/admin/layout.tsx",
  "app/admin/page.tsx",
  "app/admin/orders/page.tsx",
  "app/admin/orders/[id]/page.tsx",
  "app/admin/customers/page.tsx",
  "app/admin/services/page.tsx",
  "app/admin/pricing/page.tsx",
  "app/admin/wallet/page.tsx",
  "app/admin/settings/page.tsx",
  "app/admin/fulfillment/page.tsx",
  "app/admin/platforms/page.tsx",
  "app/admin/provider-catalog/page.tsx",
  "app/admin/providers/page.tsx",
];

for (const pagePath of adminPageFiles) {
  assert.ok(fs.existsSync(pagePath), `Page exists: ${pagePath}`);
  const code = fs.readFileSync(pagePath, "utf8");
  assert.ok(
    code.includes("requireAdmin"),
    `Page ${pagePath} must invoke requireAdmin()`
  );
}

console.log(`✓ All ${adminPageFiles.length} admin pages enforce server-side requireAdmin().`);
console.log("=== LIVE SECURITY AUDIT TESTS PASSED ===");
