import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const middleware = fs.readFileSync("middleware.ts", "utf8");
const homepageRoute = fs.readFileSync("app/api/homepage/catalog/route.ts", "utf8");
const platformsRoute = fs.readFileSync("app/api/platforms/route.ts", "utf8");
const servicesRoute = fs.readFileSync("app/api/services/route.ts", "utf8");
const serviceRoute = fs.readFileSync("app/api/services/[slug]/route.ts", "utf8");
const ordersRoute = fs.readFileSync("app/api/orders/route.ts", "utf8");
const adminRoute = fs.readFileSync("app/api/admin/services/route.ts", "utf8");
const predicateSource = middleware.match(/export function shouldSkipSupabaseSessionRefresh\([\s\S]*?\n\}/)?.[0];
assert.ok(predicateSource, "middleware exposes the session-refresh bypass predicate");
const compiledPredicate = ts.transpileModule(
  `${predicateSource}\nmodule.exports = { shouldSkipSupabaseSessionRefresh };`,
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }
).outputText;
const predicateModule = { exports: {} };
vm.runInNewContext(compiledPredicate, { module: predicateModule, exports: predicateModule.exports });
const { shouldSkipSupabaseSessionRefresh } = predicateModule.exports;

for (const path of [
  "/api/homepage/catalog",
  "/api/platforms",
  "/api/services",
  "/api/services/instagram-followers",
]) {
  assert.equal(shouldSkipSupabaseSessionRefresh("GET", path), true, `${path} GET bypasses session refresh`);
}

for (const [method, path] of [
  ["POST", "/api/homepage/catalog"],
  ["PUT", "/api/platforms"],
  ["DELETE", "/api/services"],
  ["PATCH", "/api/services/instagram-followers"],
]) {
  assert.equal(shouldSkipSupabaseSessionRefresh(method, path), false, `${method} ${path} retains middleware`);
}

for (const path of [
  "/api/services/instagram-followers/inputs",
  "/api/services-extra",
  "/api/services-extra/instagram-followers",
  "/api/platforms/instagram",
  "/api/orders",
  "/api/admin/services",
]) {
  assert.equal(shouldSkipSupabaseSessionRefresh("GET", path), false, `${path} is not bypassed`);
}

assert.match(middleware, /if \(shouldSkipSupabaseSessionRefresh\(request\.method, request\.nextUrl\.pathname\)\) return response;\s+const url = process\.env\.NEXT_PUBLIC_SUPABASE_URL;/);
assert.match(middleware, /await supabase\.auth\.getUser\(\);/);
assert.match(middleware, /request\.cookies\.set\(name, value\)/);
assert.match(middleware, /response\.cookies\.set\(name, value, options\)/);
assert.match(middleware, /NextResponse\.next\(\{ request \}\)/);

for (const [name, source] of [
  ["homepage catalog", homepageRoute],
  ["platform catalog", platformsRoute],
  ["services catalog", servicesRoute],
  ["service detail catalog", serviceRoute],
]) {
  assert.match(source, /export async function GET\(/, `${name} exposes GET`);
  assert.match(source, /consumeRateLimits/, `${name} keeps its rate limit`);
}

assert.match(ordersRoute, /getCurrentUser\(\)/, "customer order API keeps server auth");
assert.match(adminRoute, /requireAdmin\(\)/, "admin API keeps server auth");
console.log("middleware-catalog-tests: passed");
