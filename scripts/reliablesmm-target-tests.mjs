import assert from "node:assert/strict";
import { assertReliableSMMTarget, normalizeReliableSMMTarget } from "../lib/fulfillment/reliablesmm/target.ts";

const valid = assertReliableSMMTarget({ vantaSlug: "instagram-likes", targetType: "url", targetValue: " https://instagram.com/p/abc123/ " });
assert.equal(valid.link, "https://instagram.com/p/abc123/");
assert.equal(normalizeReliableSMMTarget({ vantaSlug: "instagram-likes", targetType: "url", targetValue: "not-a-url" }).valid, false);
assert.equal(normalizeReliableSMMTarget({ vantaSlug: "instagram-followers", targetType: "username", targetValue: "@creator" }).valid, false);
assert.equal(normalizeReliableSMMTarget({ vantaSlug: "facebook-page-followers", targetType: "page", targetValue: "https://facebook.com/example" }).valid, false);
assert.equal(normalizeReliableSMMTarget({ vantaSlug: "telegram-channel-members", targetType: "channel", targetValue: "@channel" }).valid, false);
assert.equal(normalizeReliableSMMTarget({ vantaSlug: "instagram-likes", targetType: "url", targetValue: "https://example.com/a\u0000" }).valid, false);
const instagramViews = assertReliableSMMTarget({ vantaSlug: "instagram-views", targetType: "url", targetValue: "https://www.instagram.com/reel/ABC_123/" });
assert.equal(instagramViews.link, "https://www.instagram.com/reel/ABC_123/");
assert.equal(normalizeReliableSMMTarget({ vantaSlug: "instagram-views", targetType: "url", targetValue: "http://www.instagram.com/reel/ABC_123/" }).valid, false);
console.log("ReliableSMM target normalization tests: PASS");
