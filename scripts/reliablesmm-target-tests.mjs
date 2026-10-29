import assert from "node:assert/strict";
import { assertReliableSMMTarget, normalizeReliableSMMTarget } from "../lib/fulfillment/reliablesmm/target.ts";

const valid = assertReliableSMMTarget({
  platformSlug: "instagram",
  targetType: "url",
  targetValue: " https://instagram.com/p/abc123/ ",
});
assert.equal(valid.link, "https://instagram.com/p/abc123/");
assert.equal(normalizeReliableSMMTarget({
  platformSlug: "instagram",
  targetType: "url",
  targetValue: "not-a-url",
}).valid, false);
assert.equal(normalizeReliableSMMTarget({
  platformSlug: "instagram",
  targetType: "username",
  targetValue: "@creator",
}).valid, false);
assert.equal(normalizeReliableSMMTarget({
  platformSlug: "facebook",
  targetType: "page",
  targetValue: "https://facebook.com/example",
}).valid, true);
assert.equal(normalizeReliableSMMTarget({
  platformSlug: "telegram",
  targetType: "channel",
  targetValue: "https://t.me/channel",
}).valid, false);
assert.equal(normalizeReliableSMMTarget({
  platformSlug: "instagram",
  targetType: "url",
  targetValue: "https://instagram.com/p/abc123\u0000",
}).valid, false);
assert.equal(normalizeReliableSMMTarget({
  platformSlug: "instagram",
  targetType: "url",
  targetValue: "https://www.instagram.com/reel/ABC_123/",
}).valid, true);
assert.equal(normalizeReliableSMMTarget({
  platformSlug: "instagram",
  targetType: "url",
  targetValue: "http://www.instagram.com/reel/ABC_123/",
}).valid, false);
assert.equal(normalizeReliableSMMTarget({
  platformSlug: "instagram",
  targetType: "url",
  targetValue: "https://www.instagram.com/p/ABC_123/#fragment",
  transformId: "normalize_url",
  transformVersion: 1,
}).target, "https://www.instagram.com/p/ABC_123/");
console.log("ReliableSMM target validation tests: PASS");
