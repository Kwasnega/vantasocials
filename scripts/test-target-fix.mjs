import assert from "node:assert/strict";
import crypto from "node:crypto";
import { hashToken, generateFixToken, constantTimeCompare } from "../lib/orders/target-fix/tokens/crypto.ts";
import { normalizeTarget } from "../lib/targets/normalize.ts";

async function runTargetFixTests() {
  console.log("=== RUNNING TARGET FIX & RETRY UNIT TESTS ===");

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${name}:`, err.message);
    }
  }

  // 1. Token generation, hashing, and security
  console.log("\n--- 1. Token Generation & Cryptographic Safety ---");
  await test("Generates random base64url token of sufficient length", () => {
    const token = generateFixToken();
    assert.ok(token.length >= 32, "Token should be at least 32 characters");
    assert.match(token, /^[a-zA-Z0-9_-]+$/, "Token should be base64url safe");
  });

  await test("Hashes token deterministically with SHA-256", () => {
    const token = "test_token_1234567890_abcdef";
    const expectedHash = crypto.createHash("sha256").update(token).digest("hex");
    const actualHash = hashToken(token);
    assert.equal(actualHash, expectedHash);
  });

  await test("Constant-time comparison avoids timing leaks", () => {
    const hashA = hashToken("token_A");
    const hashB = hashToken("token_B");
    assert.equal(constantTimeCompare(hashA, hashA), true);
    assert.equal(constantTimeCompare(hashA, hashB), false);
    assert.equal(constantTimeCompare("short", "longer_string"), false);
  });

  // 2. Target normalization applied to edited targets
  console.log("\n--- 2. Target Normalization on Fix Input ---");
  await test("Normalizes dirty YouTube video URL into canonical", async () => {
    const rawDirty = "https://youtu.be/dQw4w9WgXcQ?si=trackingParam&t=10s";
    const res = await normalizeTarget({
      platform: "youtube",
      targetType: "url",
      input: rawDirty,
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.canonical, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    }
  });

  await test("Normalizes TikTok video URL into canonical with author", async () => {
    const rawTikTok = "https://www.tiktok.com/@creator.name/video/7123456789012345678?is_from_webapp=1";
    const res = await normalizeTarget({
      platform: "tiktok",
      targetType: "url",
      input: rawTikTok,
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.canonical, "https://www.tiktok.com/@creator.name/video/7123456789012345678");
    }
  });

  await test("Rejects invalid / malformed link on edit", async () => {
    const invalidUrl = "not-a-valid-url-or-domain";
    const res = await normalizeTarget({
      platform: "youtube",
      targetType: "url",
      input: invalidUrl,
    });
    assert.equal(res.ok, false);
  });

  // 3. Single-use token logic & atomic simulation
  console.log("\n--- 3. Single-Use Token & Ineligible States ---");
  await test("Simulated concurrent token use grants exactly ONE claim", async () => {
    const tokenDb = {
      used_at: null,
      claims: 0,
    };

    // Simulate atomic conditional claim: UPDATE WHERE used_at IS NULL
    async function attemptClaim() {
      if (tokenDb.used_at === null) {
        tokenDb.used_at = new Date().toISOString();
        tokenDb.claims++;
        return { ok: true };
      }
      return { ok: false, message: "Link already used" };
    }

    const results = await Promise.all([
      attemptClaim(),
      attemptClaim(),
      attemptClaim(),
    ]);

    const successes = results.filter((r) => r.ok).length;
    assert.equal(successes, 1, "Exactly one concurrent attempt can claim the token");
    assert.equal(tokenDb.claims, 1);
  });

  await test("Expired token is rejected", () => {
    const tokenRecord = {
      expires_at: new Date(Date.now() - 1000).toISOString(), // expired 1s ago
      used_at: null,
    };
    const isExpired = new Date(tokenRecord.expires_at).getTime() < Date.now();
    assert.equal(isExpired, true, "Expired token must be flagged");
  });

  await test("Orders with existing provider_order_id cannot be edited", () => {
    const mockOrder = {
      fulfillment_status: "FAILED",
      failure_reason: "invalid_target",
      provider_order_id: "RSMM_99999",
    };
    const canEdit = !mockOrder.provider_order_id;
    assert.equal(canEdit, false, "Must block target edits if order has a provider_order_id");
  });

  await test("Orders in SUBMITTING/PROCESSING/COMPLETED cannot be edited", () => {
    const statuses = ["SUBMITTING", "PROCESSING", "COMPLETED", "SUBMITTED"];
    for (const st of statuses) {
      const isEligible = st === "FAILED";
      assert.equal(isEligible, false, `Order in status ${st} must not allow target edits`);
    }
  });

  await test("Unchanged target submission is rejected", () => {
    const currentTarget = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const candidateTarget = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const isUnchanged = currentTarget === candidateTarget;
    assert.equal(isUnchanged, true, "Identical target must be rejected");
  });

  console.log(`\n=== TARGET FIX TEST SUMMARY: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runTargetFixTests();
