import assert from "node:assert/strict";
import fs from "node:fs";
import { assessProviderEligibility } from "../lib/targets/eligibility.ts";
import { getTargetContract } from "../lib/targets/contracts.ts";
import { providerCatalogMatches } from "../lib/admin/provider-category.ts";
import { fetchAllProviderCatalogRows } from "../lib/admin/provider-catalog-query.ts";
import { matchesApprovedProviderOperation } from "../lib/admin/provider-compatibility.ts";

const candidate = (id, name, slug, extra = {}) => {
  const categoryById = { "7486": "Instagram Services", "7841": "Instagram Services", "7580": "TikTok Video Services" };
  const rawMetadata = extra.raw_metadata ?? { service: String(id), name, platform: slug.split("-")[0], target_type: "url", category: categoryById[String(id)] ?? name };
  const provider = { provider: "reliablesmm", provider_service_id: String(id), name, provider_status: "ACTIVE", provider_rate: "2.5", provider_currency: "USD", rate_unit: "PER_1000", min_quantity: 100, max_quantity: 100000, ...extra, raw_metadata: rawMetadata };
  return {
    ...provider,
    eligibility: assessProviderEligibility({
      serviceSlug: slug,
      targetContract: getTargetContract(slug),
      operationCompatibilityVerified: matchesApprovedProviderOperation(slug, String(id), name, String(rawMetadata.category ?? "")),
      expectedTargetType: "url",
      providerTargetType: String(rawMetadata.target_type ?? ""),
      platformCompatibilityState: "READY",
      vantaMin: 100,
      vantaMax: 100000,
      provider,
    }),
  };
};

assert.equal(providerCatalogMatches("facebook-post-likes", "Facebook Post Likes", "Facebook Post Likes"), true);
assert.equal(providerCatalogMatches("facebook-post-likes", "Facebook Page Likes", "Facebook Page Likes"), false);
assert.equal(providerCatalogMatches("facebook-post-likes", "Facebook Video Views", "Facebook Video Views"), false);
assert.equal(candidate(7099, "Facebook Post Likes", "facebook-post-likes").eligibility.status, "ELIGIBLE");
assert.equal(candidate(5911, "Instagram Likes", "instagram-likes").eligibility.status, "ELIGIBLE");
assert.equal(candidate(5661, "TikTok Video Views", "tiktok-views").eligibility.status, "ELIGIBLE");
assert.equal(candidate(7856, "Instagram Custom Comments", "instagram-comments", { raw_metadata: { description: "Custom Comments" } }).eligibility.status, "BLOCKED");
assert.equal(candidate(7099, "Facebook Post Likes", "facebook-page-likes").eligibility.status, "BLOCKED");
assert.equal(candidate(7486, "Instagram Video Views", "instagram-views").eligibility.status, "ELIGIBLE");
assert.equal(candidate(7972, "Instagram Followers", "instagram-followers").eligibility.status, "MANUAL_REVIEW");

const mappingControl = fs.readFileSync("app/admin/services/MappingControl.tsx", "utf8");
const styles = fs.readFileSync("app/globals.css", "utf8");
assert.match(mappingControl, /selectedIdentity\s*=\s*useRef/);
assert.match(mappingControl, /selectedIdentity\.current\s*=\s*identity\(row\)/);
assert.match(mappingControl, /selectedIdentity\.current\s*\?\?/);
assert.match(mappingControl, /row\.eligibility\s*===\s*["']ELIGIBLE["']/);
assert.match(mappingControl, /disabled=\{busy\}/);
assert.match(mappingControl, /disabled={!selected \|\| busy}/);
assert.match(mappingControl, /selected\.eligibility\s*!==\s*["']ELIGIBLE["']/);
assert.match(mappingControl, /Unavailable — \$\{row\.eligibility_reason\}/);
assert.match(mappingControl, /Select a provider service and continue\. Eligibility checks determine whether the mapping can be saved\./);
assert.match(mappingControl, /createPortal/);
assert.match(styles, /\.mapping-modal-actions \{ flex:0 0 auto; margin-top:auto;/);
assert.match(styles, /\.mapping-results \{ flex:1 1 auto; min-height:0;/);
assert.equal(assessProviderEligibility({ serviceSlug: "x-reposts", targetContract: null, vantaMin: 1, vantaMax: 100000, provider: { provider: "reliablesmm", provider_service_id: "", name: "", provider_status: "ACTIVE", provider_currency: "USD", rate_unit: "PER_1000", min_quantity: 1, max_quantity: 100000 } }).status, "BLOCKED");

const catalog = Array.from({ length: 2005 }, (_, index) => ({ id: String(index + 1), name: "Unrelated" }));
catalog[1500] = { id: "7099", name: "Facebook Post Likes" };
catalog[1800] = { id: "5911", name: "Instagram Likes" };
const paged = await fetchAllProviderCatalogRows(async (from, to) => catalog.slice(from, to + 1));
assert.equal(paged.find((row) => row.id === "7099")?.name, "Facebook Post Likes");
assert.equal(paged.find((row) => row.id === "5911")?.name, "Instagram Likes");
console.log("phase4-mapping-tests: passed");
