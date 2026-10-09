import assert from "node:assert/strict";
import { ensureProviderMappingEligibility, extractApprovedProviderParameters, normalizeFieldDraft, normalizeMappingDraft } from "../lib/admin/service-input-config.ts";

const field = normalizeFieldDraft({
  key: "target_url",
  label: "Target URL",
  inputType: "url",
  required: true,
  displayOrder: 0,
  placeholder: "https://example.com",
  helpText: "Paste the exact target URL.",
  validationConfig: { maxLength: 2048 },
  schemaVersion: 1,
  active: true,
});
assert.equal(field.key, "target_url");
assert.throws(() => normalizeFieldDraft({ ...field, inputType: "not_real" }));
assert.throws(() => normalizeFieldDraft({ ...field, validationConfig: { maxLines: 5 } }));
assert.throws(() => normalizeFieldDraft({ ...field, key: "" }));
assert.deepEqual(extractApprovedProviderParameters({ parameters: [{ key: "link", label: "Link" }, "target"] }), ["link", "target"]);
assert.deepEqual(extractApprovedProviderParameters({ random: true }), []);
const eligibleService = {
  slug: "instagram-likes",
  target_type: "url",
  min_quantity: 100,
  max_quantity: 100000,
  platforms: { slug: "instagram", name: "Instagram" },
};
const eligibleCatalog = {
  provider: "reliablesmm",
  provider_service_id: "5911",
  name: "Instagram Likes",
  provider_status: "ACTIVE",
  provider_currency: "USD",
  rate_unit: "PER_1000",
  min_quantity: 100,
  max_quantity: 250000,
  raw_metadata: { platform: "instagram", target_type: "url", description: "Instagram likes" },
};
assert.doesNotThrow(() => ensureProviderMappingEligibility(eligibleService, eligibleCatalog));
assert.throws(() => ensureProviderMappingEligibility(eligibleService, { ...eligibleCatalog, raw_metadata: { platform: "facebook", target_type: "page" } }));
assert.throws(() => ensureProviderMappingEligibility(eligibleService, { ...eligibleCatalog, raw_metadata: {} }));
assert.throws(() => ensureProviderMappingEligibility(eligibleService, { ...eligibleCatalog, provider_status: "INACTIVE" }));
assert.throws(() => ensureProviderMappingEligibility(eligibleService, { ...eligibleCatalog, provider_service_id: "9999", raw_metadata: {} }));
assert.deepEqual(extractApprovedProviderParameters({ parameters: [{ key: "link", label: "Link" }, "target"] }), ["link", "target"]);
const mapping = normalizeMappingDraft({
  serviceId: "service-1",
  provider: "reliablesmm",
  providerServiceId: "7486",
  providerParameterKey: "link",
  transformId: "normalize_url",
  transformVersion: 1,
  providerRequired: true,
  omitWhenBlank: false,
  schemaVersion: 1,
  active: true,
}, field);
assert.equal(mapping.providerParameterKey, "link");
assert.throws(() => normalizeMappingDraft({ ...mapping, provider: "unknown" }, field));
assert.throws(() => normalizeMappingDraft({ ...mapping, transformId: "normalize_comments", transformVersion: 1 }, field));
assert.throws(() => normalizeMappingDraft({ ...mapping, schemaVersion: 0 }, field));
console.log("phase33-admin-config-tests: passed");
