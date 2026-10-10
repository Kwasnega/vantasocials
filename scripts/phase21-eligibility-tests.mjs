import assert from "node:assert/strict";
import { assessProviderEligibility } from "../lib/targets/eligibility.ts";

const base = { provider: "reliablesmm", provider_service_id: "dynamic-1", name: "Dynamic likes", provider_status: "ACTIVE", provider_currency: "USD", rate_unit: "PER_1000", min_quantity: 10, max_quantity: 1000 };
assert.equal(assessProviderEligibility({ serviceSlug: "new-service", targetContract: "INSTAGRAM_CONTENT", dynamicCompatibilityVerified: true, vantaMin: 10, vantaMax: 1000, provider: base }).status, "ELIGIBLE");
assert.equal(assessProviderEligibility({ serviceSlug: "new-service", targetContract: "INSTAGRAM_CONTENT", dynamicCompatibilityVerified: false, vantaMin: 10, vantaMax: 1000, provider: base }).status, "BLOCKED");
assert.equal(assessProviderEligibility({ serviceSlug: "instagram-likes", targetContract: "INSTAGRAM_CONTENT", vantaMin: 10, vantaMax: 1000, provider: { ...base, provider_service_id: "5911" } }).status, "ELIGIBLE");
console.log("phase21-eligibility-tests: passed");
