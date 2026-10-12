import assert from "node:assert/strict";
import { assessProviderEligibility } from "../lib/targets/eligibility.ts";

const base = { provider: "reliablesmm", provider_service_id: "dynamic-1", name: "Dynamic likes", provider_status: "ACTIVE", provider_rate: "2.5", provider_currency: "USD", rate_unit: "PER_1000", min_quantity: 10, max_quantity: 1000, raw_metadata: { category: "Instagram Likes" } };
const explicitCompatibility = { expectedTargetType: "url", providerTargetType: "url", platformCompatibilityState: "READY" };
assert.equal(assessProviderEligibility({ serviceSlug: "new-service", targetContract: "INSTAGRAM_CONTENT", operationCompatibilityVerified: false, ...explicitCompatibility, vantaMin: 10, vantaMax: 1000, provider: base }).status, "MANUAL_REVIEW");
assert.equal(assessProviderEligibility({ serviceSlug: "new-service", targetContract: "INSTAGRAM_CONTENT", operationCompatibilityVerified: false, ...explicitCompatibility, providerTargetType: "page", vantaMin: 10, vantaMax: 1000, provider: base }).status, "BLOCKED");
assert.equal(assessProviderEligibility({ serviceSlug: "instagram-likes", targetContract: "INSTAGRAM_CONTENT", operationCompatibilityVerified: true, ...explicitCompatibility, vantaMin: 10, vantaMax: 1000, provider: { ...base, provider_service_id: "5911", name: "Instagram Likes", raw_metadata: { service: "5911", name: "Instagram Likes", category: "Instagram Likes" } } }).status, "ELIGIBLE");
console.log("phase21-eligibility-tests: passed");
