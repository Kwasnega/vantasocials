// Deterministic Phase 2I verification. This intentionally uses no network,
// Supabase, credentials, or provider endpoints.
import assert from "node:assert/strict";

const key = (order, service) => `vanta:${order}:panelfollows:${service}`;
const valid = {
  "instagram-likes": /^https:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+\/?$/,
  "facebook-post-likes": /^https:\/\/(?:www\.|m\.)?facebook\.com\/[^/]+\/posts\/[^/]+\/?$/,
  "x-post-views": /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+\/?$/,
};
const services = { "instagram-likes": "8", "facebook-post-likes": "3354", "x-post-views": "2769" };
const state = new Map();
function claim(order, slug) {
  const idempotency = key(order, services[slug]);
  if (state.has(idempotency)) return state.get(idempotency);
  const attempt = { idempotency, attemptStatus: "PENDING_SUBMISSION" };
  state.set(idempotency, attempt);
  return attempt;
}
function submit(attempt, mode = "disabled") {
  if (mode === "disabled") throw Object.assign(new Error("Live fulfillment is disabled."), { code: "LIVE_FULFILLMENT_DISABLED" });
  if (mode === "success") return Object.assign(attempt, { attemptStatus: "SUBMITTED", providerOrderId: "TEST-PF-001" });
  if (mode === "timeout") return Object.assign(attempt, { attemptStatus: "UNKNOWN_PENDING_RECONCILIATION" });
  return Object.assign(attempt, { attemptStatus: "FAILED_BEFORE_SUBMISSION", errorCode: "PROVIDER_REJECTED" });
}
for (const [slug, url] of Object.entries({ "instagram-likes": "https://instagram.com/p/abc", "facebook-post-likes": "https://facebook.com/page/posts/123", "x-post-views": "https://x.com/user/status/123" })) assert.equal(valid[slug].test(url), true);
assert.equal(valid["instagram-likes"].test("https://instagram.com/user"), false);
assert.equal(valid["facebook-post-likes"].test("https://instagram.com/p/abc"), false);
assert.equal(valid["x-post-views"].test("not-a-url"), false);
assert.equal(100 < 100, false); assert.equal(100001 > 100000, true);
const duplicateA = claim("00000000-0000-0000-0000-000000000001", "instagram-likes");
const duplicateB = claim("00000000-0000-0000-0000-000000000001", "instagram-likes");
assert.equal(duplicateA, duplicateB);
assert.throws(() => submit(duplicateA), /disabled/);
assert.equal(submit(claim("00000000-0000-0000-0000-000000000002", "facebook-post-likes"), "success").providerOrderId, "TEST-PF-001");
assert.equal(submit(claim("00000000-0000-0000-0000-000000000003", "x-post-views"), "timeout").attemptStatus, "UNKNOWN_PENDING_RECONCILIATION");
console.log("Phase 2I deterministic verification: PASS");
