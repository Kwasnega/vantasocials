import assert from "node:assert/strict";
import fs from "node:fs";
import {
  effectiveQuantityBounds,
  getTargetContract,
  getTargetContractForService,
  getTargetRequirements,
  normalizeTargetForService,
  resolveTargetInputField,
} from "../lib/targets/contracts.ts";
import { assessProviderEligibility } from "../lib/targets/eligibility.ts";
import { effectiveQuantityRange, quantityInRange } from "../lib/targets/quantity.ts";

assert.equal(getTargetContract("instagram-views"), "INSTAGRAM_CONTENT");
assert.equal(getTargetContract("telegram-post-views"), null);
const target = (platformSlug, targetType, value, transformId, transformVersion) =>
  normalizeTargetForService({ platformSlug, targetType, value, transformId, transformVersion });
assert.equal(getTargetContractForService({ slug: "instagram-followers", platformSlug: "instagram", targetType: "url" }), "INSTAGRAM_CONTENT", "admin platform and target type override legacy slug assumptions");
assert.equal(getTargetRequirements({ platformSlug: "instagram", targetType: "url" }).label, "Instagram post or reel URL");
assert.equal(target("instagram", "username", "https://www.instagram.com/creator/").valid, true);
assert.equal(target("instagram", "username", "https://instagram.com/p/SHORTCODE").valid, false);
assert.equal(target("instagram", "url", "https://instagram.com/p/SHORTCODE/").target, "https://instagram.com/p/SHORTCODE/");
assert.equal(target("instagram", "post_url", "https://www.instagram.com/reel/SHORTCODE").valid, true);
assert.equal(target("instagram", "video_url", "https://www.instagram.com/reel/SHORTCODE").valid, true);
assert.equal(target("instagram", "video_url", "https://www.instagram.com/p/SHORTCODE").valid, false);
assert.equal(target("instagram", "url", "https://www.tiktok.com/@creator/video/1234567890123456789").valid, false);
assert.equal(target("instagram", "url", "https://instagram.com/creator").valid, false);
assert.equal(target("instagram", "url", "").valid, false);
assert.equal(target("instagram", "url", "not a URL").valid, false);
assert.equal(target("instagram", "url", "http://instagram.com/p/SHORTCODE").valid, false);
assert.equal(target("instagram", "url", "https://evil.instagram.com/p/SHORTCODE").valid, false);
assert.equal(target("instagram", "url", "https://instagram.com.evil.test/p/SHORTCODE").valid, false);
assert.equal(target("instagram", "url", "https://user:pass@instagram.com/p/SHORTCODE").valid, false);
assert.equal(target("tiktok", "video_url", "https://www.tiktok.com/@creator/video/1234567890123456789").valid, true);
assert.equal(target("tiktok", "video_url", "https://www.tiktok.com/@creator").valid, false);
assert.equal(target("youtube", "channel", "https://www.youtube.com/@creator").valid, true);
assert.equal(target("youtube", "video_url", "https://www.youtube.com/watch?v=abcdefghijk").valid, true);
assert.equal(target("youtube", "video_url", "https://youtu.be/abcdefghijk").valid, true);
assert.equal(target("youtube", "video_url", "https://youtube.com/shorts/abcdefghijk").valid, true);
assert.equal(target("youtube", "video_url", "https://youtube.com/watch?v=too-short").valid, false);
assert.equal(target("facebook", "page", "https://www.facebook.com/page-name").valid, true);
assert.equal(target("facebook", "page", "https://www.facebook.com/page-name/posts/1").valid, false);
assert.equal(target("facebook", "post_url", "https://www.facebook.com/page-name/posts/123").valid, true);
assert.equal(target("facebook", "video_url", "https://www.facebook.com/reel/123").valid, true);
assert.equal(target("facebook", "video_url", "https://tiktok.com/@creator/video/1234567890123456789").valid, false);
assert.equal(target("telegram", "channel", "https://t.me/channel").valid, false);
assert.equal(getTargetContractForService({ platformSlug: "instagram", targetType: "channel" }), null);
assert.match(target("instagram", "url", "https://instagram.com/p/SHORTCODE?utm_source=x#section").target, /#section$/);
assert.equal(target("instagram", "url", "https://instagram.com/p/SHORTCODE?utm_source=x#section", "normalize_url", 1).target, "https://instagram.com/p/SHORTCODE?utm_source=x");
assert.equal(target("instagram", "url", "https://instagram.com/p/SHORTCODE", "trim", 1).valid, false);
assert.equal(resolveTargetInputField([{ key: "link", input_type: "url" }], "url").field.key, "link");
assert.equal(resolveTargetInputField([], "url").field, null);
assert.equal(resolveTargetInputField([{ key: "one", input_type: "url" }, { key: "two", input_type: "post_url" }], "url").field, null);
assert.deepEqual(effectiveQuantityBounds(100, 100000, 100, 10000), { min: 100, max: 10000 });
assert.deepEqual(effectiveQuantityBounds(100, 100000, 1000, 50000), { min: 1000, max: 50000 });
const provider = { provider: "reliablesmm", provider_service_id: "7486", name: "Instagram Video Views", provider_status: "ACTIVE", provider_currency: "USD", provider_rate: "2.5", rate_unit: "PER_1000", min_quantity: 100, max_quantity: 10000, raw_metadata: { service: "7486", name: "Instagram Video Views", platform: "instagram", target_type: "post_url", category: "Instagram Services" } };
const verified = { platformCompatibilityState: "READY", expectedTargetType: "post_url", providerTargetType: "post_url" };
assert.equal(assessProviderEligibility({ serviceSlug: "instagram-views", targetContract: "INSTAGRAM_CONTENT", operationCompatibilityVerified: true, ...verified, vantaMin: 100, vantaMax: 100000, provider }).status, "ELIGIBLE");
assert.equal(assessProviderEligibility({ serviceSlug: "instagram-followers", targetContract: "INSTAGRAM_PROFILE", operationCompatibilityVerified: false, ...verified, vantaMin: 100, vantaMax: 100000, provider: { ...provider, provider_service_id: "7972", name: "Instagram Followers", raw_metadata: { ...provider.raw_metadata, service: "7972", name: "Instagram Followers", category: "Instagram Followers" } } }).status, "MANUAL_REVIEW");
assert.equal(assessProviderEligibility({ serviceSlug: "instagram-comments", targetContract: null, vantaMin: 100, vantaMax: 100000, provider: { ...provider, provider_service_id: "7856", name: "Custom Comments" } }).status, "BLOCKED");
assert.equal(assessProviderEligibility({ serviceSlug: "facebook-page-likes", targetContract: null, vantaMin: 100, vantaMax: 100000, provider: { ...provider, provider_service_id: "7099", name: "Facebook Post Likes" } }).status, "BLOCKED");
assert.equal(assessProviderEligibility({ serviceSlug: "x-reposts", targetContract: null, vantaMin: 1, vantaMax: 100000, provider: { ...provider, provider_service_id: "" } }).status, "BLOCKED");
assert.deepEqual(effectiveQuantityRange(100, 100000, 100, 10000), { min: 100, max: 10000 });
assert.equal(quantityInRange(100, { min: 100, max: 10000 }), true);
assert.equal(quantityInRange(10000, { min: 100, max: 10000 }), true);
assert.equal(quantityInRange(10001, { min: 100, max: 10000 }), false);
assert.equal(quantityInRange(50000, { min: 100, max: 10000 }), false);
assert.equal(quantityInRange(100000, effectiveQuantityRange(100, 100000)), true);

const ordersRoute = fs.readFileSync("app/api/orders/route.ts", "utf8");
assert.match(ordersRoute, /normalizeTargetForService/);
assert.match(ordersRoute, /resolveTargetInputField/);
assert.match(ordersRoute, /normalizedTarget\s*=\s*result/);
assert.match(ordersRoute, /dynamic-configured-order/);
assert.match(ordersRoute, /normalizedTarget!\.target/);
const paymentInitializeRoute = fs.readFileSync("app/api/payments/initialize/route.ts", "utf8");
const paymentWalletRoute = fs.readFileSync("app/api/payments/wallet/route.ts", "utf8");
assert.match(paymentInitializeRoute, /validateConfiguredOrderTarget/);
assert.match(paymentWalletRoute, /validateConfiguredOrderTarget/);
const fulfillmentAttempt = fs.readFileSync("lib/fulfillment/reliablesmm/attempt.ts", "utf8");
assert.match(fulfillmentAttempt, /getPersistedTarget/);
assert.match(fulfillmentAttempt, /Fulfillment target does not match the paid order/);
assert.match(fulfillmentAttempt, /target_value: persistedTarget\.link/);
console.log("target-contract-tests: passed");
