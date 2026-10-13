import assert from "node:assert/strict";
import fs from "node:fs";
import { groupHomepageServices } from "../lib/catalog/homepage-contract.ts";

const read = (path) => fs.readFileSync(path, "utf8");
const component = read("components/home/ServicesShowcase.tsx");
const catalogRoute = read("app/api/homepage/catalog/route.ts");
const catalogSource = read("lib/catalog/homepage.ts");
const contract = read("lib/catalog/homepage-contract.ts");
const platformsRoute = read("app/api/platforms/route.ts");
const servicesRoute = read("app/api/services/route.ts");
const serviceSource = read("lib/catalog/services.ts");
const customerServiceSource = read("lib/customer/service-contract-server.ts");
const serviceCatalogMigration = read("supabase/migrations/20260927000000_initial_schema.sql");

const platforms = [
  { id: "platform-1", slug: "instagram", name: "Instagram", logo: "IG" },
  { id: "platform-2", slug: "tiktok", name: "TikTok", logo: "TT" },
];
const services = [
  { platform_id: "platform-1", name: "Followers", slug: "instagram-followers" },
  { platform_id: "platform-2", name: "Likes", slug: "tiktok-likes" },
  { platform_id: "unknown-platform", name: "Orphaned", slug: "orphaned-service" },
];
const grouped = groupHomepageServices(platforms, services);

assert.deepEqual(grouped.get("instagram"), [{
  platformId: "instagram",
  name: "Followers",
  slug: "instagram-followers",
}]);
assert.deepEqual(grouped.get("tiktok"), [{
  platformId: "tiktok",
  name: "Likes",
  slug: "tiktok-likes",
}]);
assert.equal(grouped.has("unknown-platform"), false);

assert.match(catalogSource, /\.from\("platforms"\)\s*\.select\("id,slug,name,logo"\)/);
assert.match(catalogSource, /\.from\("service_catalog"\)\s*\.select\("platform_id,name,slug"\)/);
assert.match(catalogSource, /Promise\.all\(/);
assert.match(catalogSource, /activePlatformIds\.has\(service\.platform_id\)/);
assert.doesNotMatch(catalogSource, /selling_rate|provider_rate|currency/);
assert.match(catalogRoute, /consumeRateLimits/);
assert.match(catalogRoute, /rateLimited\(result\)/);
assert.match(catalogRoute, /status: 503/);
assert.match(catalogRoute, /Cache-Control.*no-store/);

assert.match(component, /fetch\("\/api\/homepage\/catalog", \{ cache: "no-store" \}\)/);
assert.match(component, /addEventListener\("focus", refreshWhenVisible\)/);
assert.match(component, /addEventListener\("visibilitychange", refreshWhenVisible\)/);
assert.doesNotMatch(component, /fetch\("\/api\/platforms"\)|fetch\("\/api\/services"\)/);
assert.match(component, /useState<"loading" \| "ready" \| "empty" \| "error">\("loading"\)/);
assert.match(component, /if \(!response\.ok\) \{\s*setCatalogStatus\("error"\)/);
assert.match(component, /setCatalogStatus\("error"\)/);
assert.match(component, /setCatalogStatus\(catalog\.services\.length > 0 \? "ready" : "empty"\)/);
assert.match(component, /catch \{\s*setCatalogStatus\("error"\)/);
assert.match(component, /Services temporarily unavailable/);
assert.match(component, /No services are available right now\. Please check back soon\./);
assert.match(component, /No active services are listed for this platform yet\./);
assert.match(component, /onClick=\{\(\) => void loadCatalog\(\)\}/);
assert.match(component, /requestInFlight\.current = false/);
assert.match(component, /minHeight: "110px"/);
assert.match(component, /services\.length > 0/);
assert.doesNotMatch(component, /fallbackPlatforms|fallbackServices|getPlatforms|getServicesByPlatform/);
assert.match(component, /setPlatforms\(nextPlatforms\)/);
assert.match(component, /setServicesByPlatform\(nextServicesByPlatform\)/);
assert.match(component, /setPlatforms\(\[\]\)/);
assert.match(component, /setService\(""\)/);
assert.match(component, /servicesByPlatform\.get\(item\.id\)\?\.\[0\]\?\.name/);
assert.match(component, /href=\{`\/services\/\$\{services\.find\(\(item\) => item\.name === service\)\?\.slug/);

assert.match(platformsRoute, /export async function GET/);
assert.match(platformsRoute, /getPlatforms\(\)/);
assert.match(servicesRoute, /export async function GET/);
assert.match(servicesRoute, /getServices\(/);
assert.match(serviceSource, /selling_rate/);
assert.match(serviceSource, /activePlatforms/);
assert.match(serviceSource, /\.in\("platform_id",/);
assert.match(customerServiceSource, /getService: getCatalogService/);
assert.match(serviceCatalogMigration, /create view public\.service_catalog[\s\S]*?from public\.services[\s\S]*?where active = true/);
assert.doesNotMatch(contract, /selling_rate|provider_rate|currency/);

console.log("homepage-catalog-tests: passed");
