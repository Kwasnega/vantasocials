import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const supabase = read("lib/supabase/server.ts");
const platforms = read("lib/catalog/platforms.ts");
const services = read("lib/catalog/services.ts");
const customerService = read("lib/customer/service-contract-server.ts");

assert.match(supabase, /export function createSupabasePublicClient\(\)/);
assert.match(supabase, /createClient\(url, anonKey/);
assert.match(platforms, /createSupabasePublicClient/);
assert.match(services, /createSupabasePublicClient/);
assert.doesNotMatch(platforms, /createSupabaseServerClient/);
assert.doesNotMatch(services, /createSupabaseServerClient/);
assert.match(customerService, /createSupabaseAdminClient/);
assert.doesNotMatch(customerService, /createSupabaseServerClient/);

for (const source of [platforms, services, customerService]) {
  const cachedFunction = source.match(/unstable_cache\([\s\S]*?\n\);/);
  assert.ok(cachedFunction, "catalog query uses the shared cross-request cache");
  assert.doesNotMatch(cachedFunction[0], /cookies\(|createSupabaseServerClient/);
}

console.log("catalog-cache-dynamic-data-tests: passed");
