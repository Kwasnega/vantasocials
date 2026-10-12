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
const consistency = loadTypeScript("lib/fulfillment/provider-mapping-consistency.ts");
const pricing = loadTypeScript("lib/fulfillment/reliablesmm/pricing.ts", { "server-only": {} });

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
assert.equal(assess({ providerMetadata: metadata({ target_type: undefined }) }).status, "BLOCKED");
assert.equal(assess({ providerMetadata: metadata({ platform: undefined }) }).status, "BLOCKED");
assert.equal(assess({ providerMetadata: metadata({ category: undefined }) }).status, "BLOCKED");
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
assert.throws(() => pricing.reliableSMMCost("2.50", 2000, "UNKNOWN"), /Unsupported ReliableSMM pricing unit/);
assert.throws(() => pricing.reliableSMMCost("2.50", 0, "PER_ORDER"), /Invalid ReliableSMM pricing input/);

const worker = fs.readFileSync("lib/fulfillment/worker.ts", "utf8");
const attempt = fs.readFileSync("lib/fulfillment/reliablesmm/attempt.ts", "utf8");
const mappingApi = fs.readFileSync("app/api/admin/mappings-and-pricing/route.ts", "utf8");
const legacyMappingApi = fs.readFileSync("app/api/admin/mappings/route.ts", "utf8");
const mappingControl = fs.readFileSync("app/admin/services/MappingControl.tsx", "utf8");
assert.match(worker, /assertProviderMappingConsistency\(/);
assert.match(attempt, /dormant: true/);
assert.match(mappingApi, /eligibility\.status !== "ELIGIBLE"/);
assert.match(legacyMappingApi, /eligibility\.status !== "ELIGIBLE"/);
assert.match(mappingControl, /row\.eligibility !== "ELIGIBLE"/);

console.log("admin-provider-hardening-tests: passed");
