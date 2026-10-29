import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadTypeScript(path, dependencies = {}) {
  const source = fs.readFileSync(path, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    URL,
    require(specifier) {
      if (specifier in dependencies) return dependencies[specifier];
      throw new Error(`Unexpected import ${specifier} in ${path}`);
    },
  });
  return module.exports;
}

const compatibility = loadTypeScript("lib/admin/provider-compatibility.ts", {
  "./service-creation": { TARGET_TYPES: ["username", "url", "post_url", "video_url", "channel", "page"] },
});
const eligibility = loadTypeScript("lib/targets/eligibility.ts", {
  "./contracts": {
    getTargetContract: (slug) => slug === "instagram-views" || slug === "instagram-likes" ? "INSTAGRAM_CONTENT" : null,
    effectiveQuantityBounds: (vantaMin, vantaMax, providerMin, providerMax) => ({
      min: Math.max(vantaMin, providerMin),
      max: Math.min(vantaMax, providerMax),
    }),
  },
});
const targetContracts = loadTypeScript("lib/targets/contracts.ts");
const consistency = loadTypeScript("lib/fulfillment/provider-mapping-consistency.ts");
const pricingEngine = loadTypeScript("lib/pricing/engine.ts");
const pricing = loadTypeScript("lib/fulfillment/reliablesmm/pricing.ts", {
  "server-only": {},
  "../../pricing/engine": pricingEngine,
});

function metadata(overrides = {}) {
  return {
    service: "7486",
    name: "Instagram Video Views",
    platform: "instagram",
    target_type: "post_url",
    category: "Instagram Services",
    ...overrides,
  };
}

function assess({
  serviceSlug = "instagram-views",
  providerServiceId = "7486",
  providerMetadata = null,
  providerName = "Instagram Video Views",
  expectedTargetType = "post_url",
  providerStatus = "ACTIVE",
  providerRate = "2.5",
  operationCompatibilityVerified,
} = {}) {
  providerMetadata ??= metadata({ service: providerServiceId, name: providerName });
  operationCompatibilityVerified ??= compatibility.matchesApprovedProviderOperation(
    serviceSlug,
    providerServiceId,
    providerName,
    String(providerMetadata?.category ?? ""),
  );
  const resolved = compatibility.resolveProviderCompatibility(providerMetadata, providerName);
  const platform = compatibility.resolveProviderPlatformCompatibility(
    providerMetadata,
    { slug: "instagram", name: "Instagram" },
    providerName,
  );
  return eligibility.assessProviderEligibility({
    serviceSlug,
    targetContract: "INSTAGRAM_CONTENT",
    operationCompatibilityVerified,
    expectedTargetType,
    providerTargetType: resolved.compatibility?.targetType,
    platformCompatibilityState: platform.state,
    vantaMin: 100,
    vantaMax: 100000,
    provider: {
      provider: "reliablesmm",
      provider_service_id: providerServiceId,
      name: providerName,
      provider_status: providerStatus,
      provider_rate: providerRate,
      provider_currency: "USD",
      rate_unit: "PER_1000",
      min_quantity: 100,
      max_quantity: 50000,
      raw_metadata: providerMetadata,
    },
  });
}

assert.equal(assess().status, "ELIGIBLE", "reviewed ID, operation, platform, target and bounds are accepted");
assert.equal(
  assess({ serviceSlug: "instagram-likes", providerServiceId: "7486" }).status,
  "MANUAL_REVIEW",
  "a same-platform provider ID cannot be mapped to a different operation",
);
assert.equal(assess({ providerMetadata: metadata({ target_type: "username" }) }).status, "BLOCKED");
assert.equal(
  compatibility.resolveProviderCompatibility(metadata({ target_type: undefined }), "Instagram Video Views").compatibility?.targetType,
  "post_url",
  "Instagram content target type is inferred when provider metadata omits it",
);
const facebookProfileOrPage = {
  service: "7229",
  name: "Facebook Followers [ Page / Profile ] [ Max 100K ]",
  category: "Facebook Followers",
  platform: "facebook",
};
assert.equal(
  compatibility.resolveProviderCompatibility(facebookProfileOrPage, facebookProfileOrPage.name).compatibility?.targetType,
  "page",
  "Facebook follower operations explicitly scoped to pages or profiles infer the page target",
);
assert.equal(
  compatibility.resolveProviderCompatibility(
    { ...facebookProfileOrPage, name: "Facebook Likes", category: "Facebook Services" },
    "Facebook Likes",
  ).compatibility,
  undefined,
  "ambiguous Facebook likes without a page, profile, post, or video target are not inferred",
);
const approvedFacebookCandidate = eligibility.assessProviderEligibility({
  serviceSlug: "facebook-page-followers",
  targetContract: "FACEBOOK_PAGE",
  operationCompatibilityVerified: compatibility.matchesApprovedProviderOperation(
    "facebook-page-followers",
    "7229",
    facebookProfileOrPage.name,
    facebookProfileOrPage.category,
  ),
  expectedTargetType: "page",
  providerTargetType: compatibility.resolveProviderCompatibility(
    facebookProfileOrPage,
    facebookProfileOrPage.name,
  ).compatibility?.targetType,
  platformCompatibilityState: compatibility.resolveProviderPlatformCompatibility(
    facebookProfileOrPage,
    { slug: "facebook", name: "Facebook" },
    facebookProfileOrPage.name,
  ).state,
  vantaMin: 100,
  vantaMax: 100000,
  provider: {
    provider: "reliablesmm",
    provider_service_id: "7229",
    name: facebookProfileOrPage.name,
    provider_status: "ACTIVE",
    provider_rate: "0.0884",
    provider_currency: "USD",
    rate_unit: "PER_1000",
    min_quantity: 100,
    max_quantity: 1000000,
    raw_metadata: facebookProfileOrPage,
  },
});
assert.equal(
  approvedFacebookCandidate.status,
  "ELIGIBLE",
  "the explicitly approved Facebook Page/Profile provider service remains eligible when target metadata is inferred",
);
const unreviewedFacebookCandidate = eligibility.assessProviderEligibility({
  serviceSlug: "facebook-page-followers",
  targetContract: "FACEBOOK_PAGE",
  operationCompatibilityVerified: compatibility.matchesApprovedProviderOperation(
    "facebook-page-followers",
    "2471",
    "Facebook Followers [ Max 100K ] | All Type Profile or Page",
    "Facebook Followers",
  ),
  expectedTargetType: "page",
  providerTargetType: compatibility.resolveProviderCompatibility(
    { service: "2471", name: "Facebook Followers [ Max 100K ] | All Type Profile or Page", category: "Facebook Followers" },
    "Facebook Followers [ Max 100K ] | All Type Profile or Page",
  ).compatibility?.targetType,
  platformCompatibilityState: "READY",
  vantaMin: 100,
  vantaMax: 100000,
  provider: {
    provider: "reliablesmm",
    provider_service_id: "2471",
    name: "Facebook Followers [ Max 100K ] | All Type Profile or Page",
    provider_status: "ACTIVE",
    provider_rate: "0.2664",
    provider_currency: "USD",
    rate_unit: "PER_1000",
    min_quantity: 100,
    max_quantity: 100000,
    raw_metadata: { service: "2471", name: "Facebook Followers [ Max 100K ] | All Type Profile or Page", category: "Facebook Followers" },
  },
});
assert.equal(
  unreviewedFacebookCandidate.status,
  "MANUAL_REVIEW",
  "inferring Facebook target metadata does not implicitly approve unreviewed provider ID 2471",
);
assert.equal(
  assess({ providerMetadata: metadata({ target_type: undefined }) }).status,
  "ELIGIBLE",
  "inferred Instagram content targets still must match the VANTA target contract",
);
assert.equal(
  assess({ providerMetadata: metadata({ target_type: undefined }), expectedTargetType: "url" }).status,
  "ELIGIBLE",
  "a configured Instagram URL target resolves to the content contract and remains provider-compatible",
);
const customInstagramLikesSlug = "instagram-likes-max-100k-real-accounts";
assert.equal(
  targetContracts.getTargetContractForService({
    slug: customInstagramLikesSlug,
    platformSlug: "instagram",
    targetType: "post_url",
  }),
  "INSTAGRAM_CONTENT",
  "custom Instagram content services using post_url receive the Instagram content contract",
);
assert.equal(
  targetContracts.normalizeTargetForService({
    slug: customInstagramLikesSlug,
    platformSlug: "instagram",
    targetType: "post_url",
    value: "https://www.instagram.com/p/example/",
  }).valid,
  true,
);
assert.equal(
  targetContracts.normalizeTargetForService({
    slug: customInstagramLikesSlug,
    platformSlug: "instagram",
    targetType: "post_url",
    value: "https://example.com/p/example",
  }).valid,
  false,
);
assert.equal(
  compatibility.matchesApprovedProviderOperation(
    "instagram-likes-max-100k-real-accounts-cancel-enable-no-refill-instant-start-day-50k",
    "1881",
    "Instagram Likes [ Max 100K ] | Real Accounts | Cancel Enable | No Refill",
    "Instagram New Services [ Cheapest ]",
  ),
  true,
  "the exact approved catalog operation allows a generated Instagram Likes service slug",
);
assert.equal(
  compatibility.matchesApprovedProviderOperation(
    "instagram-likes-max-100k-real-accounts",
    "1882",
    "Instagram Likes [ Max 100K ] | Real Accounts",
    "Instagram New Services [ Cheapest ]",
  ),
  false,
  "approval of service 1881 does not approve neighboring provider services",
);
assert.equal(
  assess({
    serviceSlug: "instagram-likes-max-100k-real-accounts-cancel-enable-no-refill-instant-start-day-50k",
    providerServiceId: "1881",
    providerName: "Instagram Likes [ Max 100K ] | Real Accounts",
    providerMetadata: metadata({
      service: "1881",
      name: "Instagram Likes [ Max 100K ] | Real Accounts",
    category: "Instagram New Services [ Cheapest ]",
    target_type: undefined,
  }),
  }).status,
  "ELIGIBLE",
  "the approved Instagram likes provider ID is eligible when its operation metadata matches",
);
assert.equal(
  assess({
  serviceSlug: "instagram-likes-custom",
  providerServiceId: "1881",
  providerName: "Instagram Likes [ Max 100K ] | Real Accounts",
  providerMetadata: metadata({
    service: "1881",
    name: "Instagram Likes [ Max 100K ] | Real Accounts",
    category: "Instagram Followers",
    target_type: undefined,
  }),
  }).status,
  "MANUAL_REVIEW",
  "the approved provider ID remains blocked when its provider category does not match likes",
);
assert.equal(
  assess({ providerMetadata: metadata({ platform: undefined }) }).status,
  "ELIGIBLE",
  "a platform can be inferred from a consistent provider service name and category",
);
assert.equal(
  compatibility.resolveProviderPlatformCompatibility(
    metadata({ platform: undefined }),
    { slug: "facebook", name: "Facebook" },
    "Instagram Video Views",
  ).state,
  "PLATFORM_MISMATCH",
  "inferred platform must still match the selected VANTA platform",
);
assert.equal(
  assess({ providerMetadata: metadata({ category: undefined }) }).status,
  "MANUAL_REVIEW",
  "missing provider category metadata prevents automatic approval and requires review",
);
assert.equal(assess({ providerMetadata: metadata({ service: "5911" }) }).status, "BLOCKED");
assert.equal(
  compatibility.resolveProviderCompatibility(metadata({ platform: "facebook", network: "instagram" }), "Instagram Video Views").state,
  "MISSING_METADATA",
  "contradictory platform declarations are rejected",
);
assert.equal(assess({ providerServiceId: "999999" }).status, "MANUAL_REVIEW");
assert.equal(assess({ providerStatus: "STALE" }).status, "BLOCKED");
assert.equal(assess({ providerRate: "" }).status, "BLOCKED");
assert.equal(assess({ providerMetadata: metadata({ category: "Instagram Followers" }) }).status, "MANUAL_REVIEW");

assert.deepEqual(
  JSON.parse(JSON.stringify(consistency.assertProviderMappingConsistency(
    { provider: "reliablesmm", provider_service_id: "7486" },
    [{ provider: "reliablesmm", provider_service_id: "7486" }],
  ))),
  { provider: "reliablesmm", providerServiceId: "7486" },
);
assert.throws(
  () => consistency.assertProviderMappingConsistency(
    { provider: "reliablesmm", provider_service_id: "7486" },
    [{ provider: "reliablesmm", provider_service_id: "5911" }],
  ),
  /does not match the service-level mapping/,
);
assert.throws(
  () => consistency.assertProviderMappingConsistency(
    { provider: "reliablesmm", provider_service_id: "7486" },
    [
      { provider: "reliablesmm", provider_service_id: "7486" },
      { provider: "other", provider_service_id: "7486" },
    ],
  ),
  /does not match the service-level mapping/,
);

assert.equal(pricing.reliableSMMCost("2.50", 2000, "PER_1000"), "5");
assert.equal(pricing.reliableSMMCost("2.50", 2000, "PER_ORDER"), "2.5");
assert.equal(pricing.reliableSMMCost("0.0000009", 1000, "PER_1000"), "0.000001");
assert.throws(() => pricing.reliableSMMCost("2.50", 2000, "UNKNOWN"), /Unsupported ReliableSMM pricing unit/);
assert.throws(() => pricing.reliableSMMCost("2.50", 0, "PER_ORDER"), /Invalid ReliableSMM pricing input/);
assert.throws(() => pricing.reliableSMMCost("0.0000009", 100, "PER_1000"), /below the six-decimal precision/);

const worker = fs.readFileSync("lib/fulfillment/worker.ts", "utf8");
const attempt = fs.readFileSync("lib/fulfillment/reliablesmm/attempt.ts", "utf8");
const mappingApi = fs.readFileSync("app/api/admin/mappings-and-pricing/route.ts", "utf8");
const legacyMappingApi = fs.readFileSync("app/api/admin/mappings/route.ts", "utf8");
const mappingControl = fs.readFileSync("app/admin/services/MappingControl.tsx", "utf8");
const createServiceCard = fs.readFileSync("app/admin/services/CreateServiceCard.tsx", "utf8");
assert.match(worker, /assertProviderMappingConsistency\(/);
assert.match(attempt, /dormant: true/);
assert.match(mappingApi, /eligibility\.status !== "ELIGIBLE"/);
assert.match(legacyMappingApi, /eligibility\.status !== "ELIGIBLE"/);
assert.match(mappingControl, /selected\.eligibility !== "ELIGIBLE"/);
assert.match(createServiceCard, /not approved for this service\. Mapping is blocked pending manual review\./);
assert.match(createServiceCard, /matchesApprovedProviderOperation\(/);

console.log("admin-provider-hardening-tests: passed");
