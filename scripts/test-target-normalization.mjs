import assert from "node:assert/strict";
import { normalizeTarget, isPrivateOrInternalIp, resolveTikTokShortLink } from "../lib/targets/normalize.ts";

async function runTests() {
  console.log("=== RUNNING TARGET NORMALIZATION UNIT TESTS ===");

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

  // --- SSRF & IP Security Tests ---
  console.log("\n--- SSRF & IP Guard Tests ---");
  await test("SSRF: local loopback IPv4 isPrivateOrInternalIp", () => {
    assert.equal(isPrivateOrInternalIp("127.0.0.1"), true);
    assert.equal(isPrivateOrInternalIp("127.0.1.5"), true);
  });
  await test("SSRF: 10.x.x.x private is blocked", () => {
    assert.equal(isPrivateOrInternalIp("10.0.0.1"), true);
  });
  await test("SSRF: 192.168.x.x private is blocked", () => {
    assert.equal(isPrivateOrInternalIp("192.168.1.1"), true);
  });
  await test("SSRF: 172.16.x.x - 172.31.x.x private is blocked", () => {
    assert.equal(isPrivateOrInternalIp("172.16.0.1"), true);
    assert.equal(isPrivateOrInternalIp("172.31.255.254"), true);
    assert.equal(isPrivateOrInternalIp("172.32.0.1"), false);
  });
  await test("SSRF: 169.254.x.x link-local is blocked", () => {
    assert.equal(isPrivateOrInternalIp("169.254.169.254"), true);
  });
  await test("SSRF: IPv6 loopback and unique local are blocked", () => {
    assert.equal(isPrivateOrInternalIp("::1"), true);
    assert.equal(isPrivateOrInternalIp("fc00::1"), true);
    assert.equal(isPrivateOrInternalIp("fe80::1"), true);
  });
  await test("SSRF: Public IPs are allowed", () => {
    assert.equal(isPrivateOrInternalIp("8.8.8.8"), false);
    assert.equal(isPrivateOrInternalIp("1.1.1.1"), false);
  });

  // --- Instagram Normalization Tests (30+ cases) ---
  console.log("\n--- Instagram Tests ---");
  
  // 1. Standard post
  await test("IG: Standard /p/ with tracking query params", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "post_url",
      input: "https://www.instagram.com/p/C-1234567/?igsh=MWZzZDN4aDZ1czZtZQ==",
    });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.instagram.com/p/C-1234567/");
    assert.equal(res.id, "C-1234567");
  });

  // 2. Reel with utm parameters
  await test("IG: Reel with utm parameters", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "url",
      input: "https://www.instagram.com/reel/Daix0CtoP_K/?utm_source=ig_web_copy_link&utm_campaign=share",
    });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.instagram.com/reel/Daix0CtoP_K/");
  });

  // 3. /reels/ plural path
  await test("IG: Plural /reels/ path", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "video_url",
      input: "https://instagram.com/reels/Daix0CtoP_K",
    });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.instagram.com/reel/Daix0CtoP_K/");
  });

  // 4. /tv/ IGTV link
  await test("IG: IGTV /tv/ link", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "url",
      input: "https://instagram.com/tv/B_12345/",
    });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.instagram.com/tv/B_12345/");
  });

  // 5. Without www
  await test("IG: Without www", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "post_url",
      input: "https://instagram.com/p/Cxyz123/",
    });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.instagram.com/p/Cxyz123/");
  });

  // 6. Without protocol
  await test("IG: Without protocol", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "post_url",
      input: "instagram.com/p/Cxyz123",
    });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.instagram.com/p/Cxyz123/");
  });

  // 7. Mobile m.instagram.com
  await test("IG: Mobile m.instagram.com", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "post_url",
      input: "https://m.instagram.com/p/Cxyz123/",
    });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.instagram.com/p/Cxyz123/");
  });

  // 8. With user in path: instagram.com/{user}/p/{shortcode}
  await test("IG: With username in path", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "post_url",
      input: "https://www.instagram.com/john_doe/p/Cxyz123/?igsh=123",
    });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.instagram.com/p/Cxyz123/");
  });

  // 9. With fragment #comment
  await test("IG: Strip fragment #comments", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "post_url",
      input: "https://www.instagram.com/p/Cxyz123/#comment-99",
    });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.instagram.com/p/Cxyz123/");
  });

  // 10. instagr.am short domain
  await test("IG: instagr.am domain", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "post_url",
      input: "https://instagr.am/p/Cxyz123/",
    });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.instagram.com/p/Cxyz123/");
  });

  // 11. Uppercase in domain and scheme
  await test("IG: Mixed uppercase in domain", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "post_url",
      input: "HTTPS://WWW.INSTAGRAM.COM/P/Cxyz123/",
    });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.instagram.com/p/Cxyz123/");
  });

  // 12. Multiple query params (img_index, etc.)
  await test("IG: Carousel img_index parameter", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "post_url",
      input: "https://www.instagram.com/p/Cxyz123/?img_index=2&igsh=123",
    });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.instagram.com/p/Cxyz123/");
  });

  // 13. Username with leading @
  await test("IG Username: Leading @ stripped and lowercased", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "username",
      input: "@Creator_Name.99",
    });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "creator_name.99");
    assert.equal(res.kind, "username");
  });

  // 14. Username with whitespace
  await test("IG Username: Trim surrounding whitespace", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "username",
      input: "   @cool.creator   ",
    });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "cool.creator");
  });

  // 15. Username with spaces inside rejected
  await test("IG Username: Spaces inside rejected", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "username",
      input: "cool creator",
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "INVALID_USERNAME");
  });

  // 16. Username invalid chars rejected
  await test("IG Username: Special chars like ! rejected", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "username",
      input: "cool!creator",
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "INVALID_USERNAME");
  });

  // 17. Username ending with dot rejected
  await test("IG Username: Ending with dot rejected", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "username",
      input: "creator.",
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "INVALID_USERNAME");
  });

  // 18. Username URL pasted in username field
  await test("IG Username: Full URL pasted in username field extracts username", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "username",
      input: "https://www.instagram.com/mfs_ediboard?utm_source=qr",
    });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "mfs_ediboard");
  });

  // 19. Cross platform link: TikTok link on Instagram
  await test("IG: Wrong platform (TikTok link submitted)", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "post_url",
      input: "https://www.tiktok.com/@creator/video/1234567890",
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "WRONG_PLATFORM");
  });

  // 20. Cross platform link: YouTube link on Instagram
  await test("IG: Wrong platform (YouTube link submitted)", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "post_url",
      input: "https://youtu.be/abc123xyz",
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "WRONG_PLATFORM");
  });

  // 21. Empty input
  await test("IG: Empty input rejected", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "post_url",
      input: "   ",
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "INVALID_INPUT");
  });

  // 22. Random garbage input
  await test("IG: Garbage text rejected", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "post_url",
      input: "not a url at all",
    });
    assert.equal(res.ok, false);
  });

  // 23. Invalid shortcode characters
  await test("IG: Invalid shortcode characters", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "post_url",
      input: "https://www.instagram.com/p/Cxyz<script>/",
    });
    assert.equal(res.ok, false);
  });

  // 24. Reel with mdxt param (observed in production)
  await test("IG: Reel with mdxt param stripped", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "url",
      input: "https://www.instagram.com/reel/Daix0CtoP_K/?mdxt=MTZ2N21iMHZ6Z3R3bQ==",
    });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.instagram.com/reel/Daix0CtoP_K/");
  });

  // 25. Username length > 30 rejected
  await test("IG: Username length > 30 rejected", async () => {
    const res = await normalizeTarget({
      platform: "instagram",
      targetType: "username",
      input: "a".repeat(31),
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "INVALID_USERNAME");
  });

  // --- TikTok Normalization Tests (30+ cases) ---
  console.log("\n--- TikTok Tests ---");

  // 26. Standard video URL with tracking params
  await test("TikTok: Video URL with ?_r and ?_t tracking stripped", async () => {
    const res = await normalizeTarget({
      platform: "tiktok",
      targetType: "post_url",
      input: "https://www.tiktok.com/@kkorsahhh/video/7123456789012345678?_r=1&_t=ZS-9B1bHmozCaq",
      resolveShortLinks: false,
    });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.tiktok.com/@kkorsahhh/video/7123456789012345678");
    assert.equal(res.id, "7123456789012345678");
  });

  // 27. Video URL with is_from_webapp & sender_device
  await test("TikTok: Video URL with is_from_webapp stripped", async () => {
    const res = await normalizeTarget({
      platform: "tiktok",
      targetType: "url",
      input: "https://tiktok.com/@creator.official/video/7987654321098765432?is_from_webapp=1&sender_device=pc",
      resolveShortLinks: false,
    });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.tiktok.com/@creator.official/video/7987654321098765432");
  });

  // 28. /v/ path format
  await test("TikTok: /v/ path format", async () => {
    const res = await normalizeTarget({
      platform: "tiktok",
      targetType: "post_url",
      input: "https://www.tiktok.com/v/7123456789012345678.html",
      resolveShortLinks: false,
    });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.tiktok.com/video/7123456789012345678");
  });

  // 29. Profile URL without trailing slash
  await test("TikTok: Profile URL for follower service with tracking params", async () => {
    const res = await normalizeTarget({
      platform: "tiktok",
      targetType: "username",
      input: "https://www.tiktok.com/@junovale8?_r=1&_t=ZS-9BMMAJXJ5tA",
      resolveShortLinks: false,
    });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "junovale8");
  });

  // 30. Clean handle in username field
  await test("TikTok: Clean handle in username field", async () => {
    const res = await normalizeTarget({
      platform: "tiktok",
      targetType: "username",
      input: "@junovale8",
      resolveShortLinks: false,
    });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "junovale8");
  });

  // 31. TikTok handle with invalid chars
  await test("TikTok: Handle with space rejected", async () => {
    const res = await normalizeTarget({
      platform: "tiktok",
      targetType: "username",
      input: "juno vale",
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "INVALID_USERNAME");
  });

  // 32. Mock short link resolution: vt.tiktok.com
  await test("TikTok Short Link: Mock vt.tiktok.com resolution", async () => {
    const mockFetch = async () => ({
      status: 301,
      ok: false,
      headers: new Headers({
        location: "https://www.tiktok.com/@artist/video/7345678901234567890?_t=8",
      }),
    });
    const res = await resolveTikTokShortLink("https://vt.tiktok.com/ZSpkVm8Pu/", mockFetch);
    assert.equal(res.ok, true);
    assert.equal(res.url, "https://www.tiktok.com/@artist/video/7345678901234567890?_t=8");
  });

  // 33. Mock short link SSRF attempt: redirect to 127.0.0.1
  await test("TikTok Short Link: SSRF attempt to localhost blocked", async () => {
    const mockFetch = async () => ({
      status: 302,
      headers: new Headers({
        location: "http://127.0.0.1/admin",
      }),
    });
    const res = await resolveTikTokShortLink("https://vt.tiktok.com/malicious", mockFetch);
    assert.equal(res.ok, false);
    assert.equal(res.code, "SSRF_BLOCKED");
  });

  // 34. Mock short link SSRF attempt: redirect to external domain (e.g. evil.com)
  await test("TikTok Short Link: Redirect to non-TikTok host blocked", async () => {
    const mockFetch = async () => ({
      status: 302,
      headers: new Headers({
        location: "https://evil.com/video/123",
      }),
    });
    const res = await resolveTikTokShortLink("https://vt.tiktok.com/redirect-evil", mockFetch);
    assert.equal(res.ok, false);
    assert.equal(res.code, "SSRF_BLOCKED");
  });

  // 35. Wrong platform: Instagram URL on TikTok
  await test("TikTok: Wrong platform (Instagram submitted)", async () => {
    const res = await normalizeTarget({
      platform: "tiktok",
      targetType: "post_url",
      input: "https://www.instagram.com/p/C-1234567/",
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "WRONG_PLATFORM");
  });

  // 36. Pass-through for other platforms (e.g. Telegram)
  await test("Other Platform: Telegram pass-through", async () => {
    const res = await normalizeTarget({
      platform: "telegram",
      targetType: "username",
      input: "https://t.me/AybshBsh",
    });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://t.me/AybshBsh");
  });

  console.log(`\n=== UNIT TEST SUMMARY: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runTests();
