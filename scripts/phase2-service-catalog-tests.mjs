import assert from "node:assert/strict";
import fs from "node:fs";

const catalogRoute = fs.readFileSync("app/api/admin/provider-catalog/route.ts", "utf8");
const createRoute = fs.readFileSync("app/api/admin/services/route.ts", "utf8");
const card = fs.readFileSync("app/admin/services/CreateServiceCard.tsx", "utf8");

assert.match(catalogRoute, /requireAdmin\(\)/);
assert.match(catalogRoute, /provider_catalog_services/);
assert.match(catalogRoute, /fetchAllProviderCatalogRows/);
assert.match(catalogRoute, /browse/);
assert.match(catalogRoute, /mapped_service/);
assert.match(createRoute, /provider_catalog_services/);
assert.match(createRoute, /providerServiceId/);
assert.match(createRoute, /provider_status.*ACTIVE/);
assert.match(createRoute, /active: false/);
assert.doesNotMatch(createRoute, /provider_rate:/);
assert.doesNotMatch(createRoute, /provider_currency:/);
assert.doesNotMatch(createRoute, /raw_metadata:/);
assert.match(card, /provider-catalog\?browse=1/);
assert.match(card, /Customer selling price/);
assert.match(card, /Compatibility is determined by the server catalog result/);
assert.match(card, /disabled=\{s!=="READY"\}/);
assert.match(card, /status\(selected,platforms\)\[0\]!=="READY"/);
assert.match(card, /mapped_service/);
console.log("phase2-service-catalog-tests: passed");
