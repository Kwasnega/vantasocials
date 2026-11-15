import assert from "node:assert/strict";
import { sanitizePreviewText } from "../lib/link-preview/sanitize.ts";
import { linkPreviewCache } from "../lib/link-preview/cache.ts";
import { youtubeAdapter } from "../lib/link-preview/adapters/youtube.ts";
import { xAdapter } from "../lib/link-preview/adapters/x.ts";
import { getLinkPreview } from "../lib/link-preview/index.ts";

async function runTests() {
  console.log("=== RUNNING LINK PREVIEW UNIT TESTS ===");

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

  // --- 1. Text Sanitization Tests ---
  console.log("\n--- 1. Text Sanitization & Anti-XSS Tests ---");
  await test("Strips script tags and inner markup", () => {
    const raw = "<script>alert('xss')</script>Hello <b>World</b>";
    const cleaned = sanitizePreviewText(raw);
    assert.equal(cleaned, "alert('xss')Hello World");
  });

  await test("Unescapes standard HTML entities", () => {
    const raw = "AT&amp;T &quot;Fast&quot; &lt;5G&gt; &#39;Speed&#39;";
    const cleaned = sanitizePreviewText(raw);
    assert.equal(cleaned, 'AT&T "Fast" <5G> \'Speed\'');
  });

  await test("Truncates to custom character limit with ellipsis", () => {
    const raw = "A".repeat(200);
    const cleaned = sanitizePreviewText(raw, 50);
    assert.equal(cleaned.length, 51); // 50 + '…'
    assert.ok(cleaned.endsWith("…"));
  });

  await test("Removes ASCII control characters", () => {
    const raw = "Bad\x00Control\x07Characters\x1FTest";
    const cleaned = sanitizePreviewText(raw);
    assert.equal(cleaned, "BadControlCharactersTest");
  });

  // --- 2. In-Memory Cache & Coalescing Tests ---
  console.log("\n--- 2. Cache & Request Coalescing Tests ---");
  await test("Caches successful previews", () => {
    linkPreviewCache.clear();
    const mockSuccess = {
      ok: true,
      data: {
        title: "Test Video",
        authorName: "Test Creator",
        providerName: "YouTube",
        fetchedAt: new Date().toISOString(),
      },
    };
    linkPreviewCache.set("test-key", mockSuccess);
    const cached = linkPreviewCache.get("test-key");
    assert.ok(cached);
    assert.equal(cached.ok, true);
    if (cached.ok) {
      assert.equal(cached.data.title, "Test Video");
    }
  });

  await test("Does not cache TIMEOUT or UNAVAILABLE", () => {
    linkPreviewCache.clear();
    linkPreviewCache.set("fail-timeout", { ok: false, code: "TIMEOUT" });
    linkPreviewCache.set("fail-unavail", { ok: false, code: "UNAVAILABLE" });
    assert.equal(linkPreviewCache.get("fail-timeout"), null);
    assert.equal(linkPreviewCache.get("fail-unavail"), null);
  });

  await test("Coalesces simultaneous concurrent requests", async () => {
    linkPreviewCache.clear();
    let invocations = 0;
    const slowFetcher = async () => {
      invocations++;
      await new Promise((r) => setTimeout(r, 50));
      return {
        ok: true,
        data: {
          title: "Coalesced Video",
          authorName: "Author",
          providerName: "YouTube",
          fetchedAt: new Date().toISOString(),
        },
      };
    };

    const [r1, r2, r3] = await Promise.all([
      linkPreviewCache.coalesce("coal-key", slowFetcher),
      linkPreviewCache.coalesce("coal-key", slowFetcher),
      linkPreviewCache.coalesce("coal-key", slowFetcher),
    ]);

    assert.equal(invocations, 1);
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.equal(r3.ok, true);
  });

  // --- 3. Registry & Unsupported Platform Tests ---
  console.log("\n--- 3. Registry & Unsupported Handling ---");
  await test("TikTok shortlink or unsupported URL returns UNSUPPORTED with 0 network calls", async () => {
    const res = await getLinkPreview("tiktok", "https://vm.tiktok.com/ZM8abc123/");
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.code, "UNSUPPORTED");
    }
  });

  await test("Instagram platform returns UNSUPPORTED with 0 network calls", async () => {
    const res = await getLinkPreview("instagram", "https://www.instagram.com/p/12345/");
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.code, "UNSUPPORTED");
    }
  });

  await test("Telegram platform returns UNSUPPORTED with 0 network calls", async () => {
    const res = await getLinkPreview("telegram", "https://t.me/channel/123");
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.code, "UNSUPPORTED");
    }
  });

  // --- 4. Live Adapter Probes ---
  console.log("\n--- 4. Live Adapter Integration ---");
  await test("YouTube adapter retrieves public video metadata", async () => {
    const res = await youtubeAdapter.getPreview("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.ok(res.data.title.includes("Rick Astley") || res.data.title.includes("Never Gonna Give You Up"));
      assert.equal(res.data.providerName, "YouTube");
      assert.ok(res.data.thumbnailUrl && res.data.thumbnailUrl.startsWith("https://i.ytimg.com/"));
    }
  });

  await test("YouTube adapter returns NOT_FOUND for nonexistent video", async () => {
    const res = await youtubeAdapter.getPreview("https://www.youtube.com/watch?v=00000000000");
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.code, "NOT_FOUND");
    }
  });

  await test("X adapter retrieves public post text and author", async () => {
    const res = await xAdapter.getPreview("https://x.com/jack/status/20");
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.data.authorName, "@jack");
      assert.ok(res.data.title.includes("setting up my twttr"));
      assert.equal(res.data.providerName, "X");
    }
  });

  await test("X adapter returns NOT_FOUND for nonexistent tweet", async () => {
    const res = await xAdapter.getPreview("https://x.com/jack/status/999999999999999999999");
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.code, "NOT_FOUND");
    }
  });

  console.log(`\n=== UNIT TEST SUMMARY: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runTests();
