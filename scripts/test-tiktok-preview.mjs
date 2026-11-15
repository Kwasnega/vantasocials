import assert from "node:assert/strict";
import { tiktokAdapter } from "../lib/link-preview/adapters/tiktok.ts";
import { getLinkPreview } from "../lib/link-preview/index.ts";

async function runTikTokTests() {
  console.log("=== RUNNING TIKTOK LINK PREVIEW UNIT TESTS ===");

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

  // 1. Assert fetch is NEVER invoked
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;
  globalThis.fetch = () => {
    fetchCallCount++;
    throw new Error("Network request made! TikTok adapter must never make network calls.");
  };

  try {
    // 2. Canonical matching test with letters, digits, underscores, dots
    await test("Valid canonical link with standard username", async () => {
      const res = await tiktokAdapter.getPreview("https://www.tiktok.com/@tiktok_user/video/7123456789012345678");
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.data.title, null);
        assert.equal(res.data.authorName, "@tiktok_user");
        assert.equal(res.data.authorUrl, "https://www.tiktok.com/@tiktok_user");
        assert.equal(res.data.thumbnailUrl, null);
        assert.equal(res.data.providerName, "TikTok");
      }
    });

    await test("Valid canonical link with dots, digits, and underscores", async () => {
      const res = await tiktokAdapter.getPreview("https://www.tiktok.com/@user.name_99/video/7234567890123456789");
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.data.authorName, "@user.name_99");
        assert.equal(res.data.authorUrl, "https://www.tiktok.com/@user.name_99");
      }
    });

    // 3. Username boundary / charset rules
    await test("Rejects username ending with period (charset rule)", async () => {
      const res = await tiktokAdapter.getPreview("https://www.tiktok.com/@user.ending.dot./video/7123456789012345678");
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.code, "UNSUPPORTED");
      }
    });

    await test("Rejects username shorter than 2 chars", async () => {
      const res = await tiktokAdapter.getPreview("https://www.tiktok.com/@a/video/7123456789012345678");
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.code, "UNSUPPORTED");
      }
    });

    await test("Rejects username longer than 24 chars", async () => {
      const longUser = "a".repeat(25);
      const res = await tiktokAdapter.getPreview(`https://www.tiktok.com/@${longUser}/video/7123456789012345678`);
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.code, "UNSUPPORTED");
      }
    });

    // 4. Short links / unresolved links return UNSUPPORTED
    await test("Unresolved short links (vm.tiktok.com) return UNSUPPORTED", async () => {
      const res = await tiktokAdapter.getPreview("https://vm.tiktok.com/ZM8abc123/");
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.code, "UNSUPPORTED");
      }
    });

    await test("Profile link without video id returns UNSUPPORTED", async () => {
      const res = await tiktokAdapter.getPreview("https://www.tiktok.com/@username");
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.code, "UNSUPPORTED");
      }
    });

    // 5. Non-matching hosts return UNSUPPORTED
    await test("Other domain returns UNSUPPORTED", async () => {
      const res = await tiktokAdapter.getPreview("https://example.com/@user/video/12345");
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.code, "UNSUPPORTED");
      }
    });

    // 6. Registry integration test via getLinkPreview
    await test("getLinkPreview('tiktok', canonicalUrl) dispatches to tiktokAdapter without network call", async () => {
      const res = await getLinkPreview("tiktok", "https://www.tiktok.com/@charlidamelio/video/7000000000000000000");
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.data.authorName, "@charlidamelio");
        assert.equal(res.data.title, null);
        assert.equal(res.data.thumbnailUrl, null);
      }
    });

    // 7. Verify zero network calls were made across all tests
    await test("Zero network calls made across all tests", () => {
      assert.equal(fetchCallCount, 0, `Expected 0 fetch calls, but got ${fetchCallCount}`);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log(`\n=== TIKTOK PREVIEW TEST SUMMARY: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runTikTokTests();
