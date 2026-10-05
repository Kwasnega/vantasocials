import assert from "node:assert/strict";
import fs from "node:fs";
import { assessProviderEligibility } from "../lib/targets/eligibility.ts";
import { getTargetContract } from "../lib/targets/contracts.ts";
import { providerCatalogMatches } from "../lib/admin/provider-category.ts";
import { fetchAllProviderCatalogRows } from "../lib/admin/provider-catalog-query.ts";

const candidate = (id, name, slug, extra = {}) => ({
  provider: "reliablesmm", provider_service_id: String(id), name, provider_status: "ACTIVE",
  provider_currency: "USD", rate_unit: "PER_1000", min_quantity: 100, max_quantity: 100000, ...extra,
  eligibility: assessProviderEligibility({ serviceSlug: slug, targetContract: getTargetContract(slug), vantaMin: 100, vantaMax: 100000, provider: { provider: "reliablesmm", provider_service_id: String(id), name, provider_status: "ACTIVE", provider_currency: "USD", rate_unit: "PER_1000", min_quantity: 100, max_quantity: 100000, raw_metadata: extra.raw_metadata } }),
});

assert.equal(providerCatalogMatches("facebook-post-likes", "Facebook Post Likes", "Facebook Post Likes"), true);
assert.equal(providerCatalogMatches("facebook-post-likes", "Facebook Page Likes", "Facebook Page Likes"), false);
assert.equal(providerCatalogMatches("facebook-post-likes", "Facebook Video Views", "Facebook Video Views"), false);
assert.equal(candidate(7099, "Facebook Post Likes", "facebook-post-likes").eligibility.status, "ELIGIBLE");
assert.equal(candidate(5911, "Instagram Likes", "instagram-likes").eligibility.status, "ELIGIBLE");
assert.equal(candidate(5661, "TikTok Video Views", "tiktok-views").eligibility.status, "ELIGIBLE");
assert.equal(candidate(7856, "Instagram Custom Comments", "instagram-comments", { raw_metadata: { description: "Custom Comments" } }).eligibility.status, "BLOCKED");
assert.equal(candidate(7099, "Facebook Post Likes", "facebook-page-likes").eligibility.status, "BLOCKED");
assert.equal(candidate(7486, "Instagram Views", "instagram-views").eligibility.status, "ELIGIBLE");
assert.equal(candidate(7972, "Instagram Followers", "instagram-followers").eligibility.status, "MANUAL_REVIEW");

const mappingControl = fs.readFileSync("app/admin/services/MappingControl.tsx", "utf8");
assert.match(mappingControl, /selectedIdentity\s*=\s*useRef/);
assert.match(mappingControl, /selectedIdentity\.current\s*=\s*identity\(row\)/);
assert.match(mappingControl, /wanted=selectedIdentity\.current/);
assert.match(mappingControl, /row\.eligibility===\"ELIGIBLE\"/);
assert.equal(assessProviderEligibility({ serviceSlug: "x-reposts", targetContract: null, vantaMin: 1, vantaMax: 100000, provider: { provider: "reliablesmm", provider_service_id: "", name: "", provider_status: "ACTIVE", provider_currency: "USD", rate_unit: "PER_1000", min_quantity: 1, max_quantity: 100000 } }).status, "BLOCKED");

const catalog = Array.from({ length: 2005 }, (_, index) => ({ id: String(index + 1), name: "Unrelated" }));
catalog[1500] = { id: "7099", name: "Facebook Post Likes" };
catalog[1800] = { id: "5911", name: "Instagram Likes" };
const paged = await fetchAllProviderCatalogRows(async (from, to) => catalog.slice(from, to + 1));
assert.equal(paged.find((row) => row.id === "7099")?.name, "Facebook Post Likes");
assert.equal(paged.find((row) => row.id === "5911")?.name, "Instagram Likes");
console.log("phase4-mapping-tests: passed");
