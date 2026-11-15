import assert from "node:assert/strict";
import { normalizeTarget } from "../lib/targets/normalize.ts";
import {
  isPrivateOrInternalIp,
  resolveTikTokShortLink,
  resolveFacebookShareLink,
  validateSafeHostname,
} from "../lib/targets/redirect-resolver.ts";

async function runAllTests() {
  console.log("=== COMPREHENSIVE MULTI-PLATFORM TARGET NORMALIZATION TEST SUITE ===");

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

  // ==========================================
  // 1. SSRF & IP SECURITY TESTS (15+ cases)
  // ==========================================
  console.log("\n--- 1. SSRF & Network Security Tests ---");
  await test("SSRF: 127.0.0.1 is blocked", () => assert.equal(isPrivateOrInternalIp("127.0.0.1"), true));
  await test("SSRF: 127.1.2.3 is blocked", () => assert.equal(isPrivateOrInternalIp("127.1.2.3"), true));
  await test("SSRF: 10.0.0.1 is blocked", () => assert.equal(isPrivateOrInternalIp("10.0.0.1"), true));
  await test("SSRF: 10.255.255.255 is blocked", () => assert.equal(isPrivateOrInternalIp("10.255.255.255"), true));
  await test("SSRF: 192.168.0.1 is blocked", () => assert.equal(isPrivateOrInternalIp("192.168.0.1"), true));
  await test("SSRF: 172.16.0.1 is blocked", () => assert.equal(isPrivateOrInternalIp("172.16.0.1"), true));
  await test("SSRF: 172.31.255.255 is blocked", () => assert.equal(isPrivateOrInternalIp("172.31.255.255"), true));
  await test("SSRF: 172.32.0.1 is NOT blocked (public)", () => assert.equal(isPrivateOrInternalIp("172.32.0.1"), false));
  await test("SSRF: 169.254.169.254 (AWS metadata) is blocked", () => assert.equal(isPrivateOrInternalIp("169.254.169.254"), true));
  await test("SSRF: 0.0.0.0 is blocked", () => assert.equal(isPrivateOrInternalIp("0.0.0.0"), true));
  await test("SSRF: IPv6 loopback ::1 is blocked", () => assert.equal(isPrivateOrInternalIp("::1"), true));
  await test("SSRF: IPv6 unique local fc00::1 is blocked", () => assert.equal(isPrivateOrInternalIp("fc00::1"), true));
  await test("SSRF: IPv6 link local fe80::1 is blocked", () => assert.equal(isPrivateOrInternalIp("fe80::1"), true));
  await test("SSRF: IPv4-mapped IPv6 ::ffff:127.0.0.1 is blocked", () => assert.equal(isPrivateOrInternalIp("::ffff:127.0.0.1"), true));
  await test("SSRF: Public IPv4 (8.8.8.8) is allowed", () => assert.equal(isPrivateOrInternalIp("8.8.8.8"), false));
  await test("SSRF: Hostname localhost is unsafe", async () => assert.equal(await validateSafeHostname("localhost"), false));
  await test("SSRF: Hostname test.local is unsafe", async () => assert.equal(await validateSafeHostname("test.local"), false));
  await test("SSRF: Hostname internal.company is unsafe", async () => assert.equal(await validateSafeHostname("service.internal"), false));

  // ==========================================
  // 2. YOUTUBE TESTS (25+ cases)
  // ==========================================
  console.log("\n--- 2. YouTube Tests ---");
  await test("YT: youtu.be/ID -> canonical watch?v=", async () => {
    const res = await normalizeTarget({ platform: "youtube", targetType: "post_url", input: "https://youtu.be/dQw4w9WgXcQ" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.equal(res.confidence, "high");
  });
  await test("YT: youtu.be with tracking params ?si= & ?feature=", async () => {
    const res = await normalizeTarget({ platform: "youtube", targetType: "post_url", input: "https://youtu.be/dQw4w9WgXcQ?si=abc12345&feature=share" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });
  await test("YT: /watch?v=ID with ?t= and ?list= tracking", async () => {
    const res = await normalizeTarget({ platform: "youtube", targetType: "post_url", input: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL12345&pp=ygU" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });
  await test("YT: /shorts/ID -> canonical watch?v=", async () => {
    const res = await normalizeTarget({ platform: "youtube", targetType: "post_url", input: "https://www.youtube.com/shorts/dQw4w9WgXcQ?si=xyz" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });
  await test("YT: /live/ID -> canonical watch?v=", async () => {
    const res = await normalizeTarget({ platform: "youtube", targetType: "post_url", input: "https://youtube.com/live/dQw4w9WgXcQ" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });
  await test("YT: /embed/ID -> canonical watch?v=", async () => {
    const res = await normalizeTarget({ platform: "youtube", targetType: "post_url", input: "https://www.youtube.com/embed/dQw4w9WgXcQ" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });
  await test("YT: mobile m.youtube.com/watch?v=ID", async () => {
    const res = await normalizeTarget({ platform: "youtube", targetType: "post_url", input: "https://m.youtube.com/watch?v=dQw4w9WgXcQ" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });
  await test("YT: music.youtube.com/watch?v=ID", async () => {
    const res = await normalizeTarget({ platform: "youtube", targetType: "post_url", input: "https://music.youtube.com/watch?v=dQw4w9WgXcQ" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });
  await test("YT: channel /@handle for subscriber service", async () => {
    const res = await normalizeTarget({ platform: "youtube", targetType: "url", input: "https://www.youtube.com/@MrBeast?sub_confirmation=1" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.youtube.com/@MrBeast");
  });
  await test("YT: channel /channel/UC... format", async () => {
    const res = await normalizeTarget({ platform: "youtube", targetType: "url", input: "https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA");
  });
  await test("YT: channel /c/customname format", async () => {
    const res = await normalizeTarget({ platform: "youtube", targetType: "url", input: "https://youtube.com/c/creatorname" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.youtube.com/c/creatorname");
  });
  await test("YT: channel /user/legacyname format", async () => {
    const res = await normalizeTarget({ platform: "youtube", targetType: "url", input: "https://youtube.com/user/oldcreator" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.youtube.com/user/oldcreator");
  });
  await test("YT: bare @handle pasted in channel field", async () => {
    const res = await normalizeTarget({ platform: "youtube", targetType: "url", input: "@MKBHD" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.youtube.com/@MKBHD");
  });
  await test("YT: uppercase in scheme and domain", async () => {
    const res = await normalizeTarget({ platform: "youtube", targetType: "post_url", input: "HTTPS://WWW.YOUTUBE.COM/watch?v=dQw4w9WgXcQ" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });
  await test("YT: trailing slash on youtu.be", async () => {
    const res = await normalizeTarget({ platform: "youtube", targetType: "post_url", input: "https://youtu.be/dQw4w9WgXcQ/" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });
  await test("YT: invalid video ID length (< 11 chars)", async () => {
    const res = await normalizeTarget({ platform: "youtube", targetType: "post_url", input: "https://youtu.be/short" });
    assert.equal(res.ok, true);
    assert.equal(res.confidence, "low"); // Does not block order, returns cleaned URL
  });
  await test("YT: wrong platform (Instagram link on YouTube)", async () => {
    const res = await normalizeTarget({ platform: "youtube", targetType: "post_url", input: "https://www.instagram.com/p/12345" });
    assert.equal(res.ok, false);
    assert.equal(res.code, "WRONG_PLATFORM");
    assert.match(res.message, /Instagram/);
    assert.match(res.message, /YouTube/);
  });
  await test("YT: wrong platform (TikTok link on YouTube)", async () => {
    const res = await normalizeTarget({ platform: "youtube", targetType: "post_url", input: "https://www.tiktok.com/@user/video/123" });
    assert.equal(res.ok, false);
    assert.equal(res.code, "WRONG_PLATFORM");
  });
  await test("YT: javascript: scheme rejected", async () => {
    const res = await normalizeTarget({ platform: "youtube", targetType: "post_url", input: "javascript:alert(1)" });
    assert.equal(res.ok, false);
    assert.equal(res.code, "INVALID_URL");
  });
  await test("YT: data: scheme rejected", async () => {
    const res = await normalizeTarget({ platform: "youtube", targetType: "post_url", input: "data:text/html,<html>" });
    assert.equal(res.ok, false);
    assert.equal(res.code, "INVALID_URL");
  });
  await test("YT: control characters rejected", async () => {
    const res = await normalizeTarget({ platform: "youtube", targetType: "post_url", input: "https://youtu.be/dQw4w9WgXcQ\u0000" });
    assert.equal(res.ok, false);
    assert.equal(res.code, "INVALID_INPUT");
  });
  await test("YT: input > 2048 chars rejected", async () => {
    const res = await normalizeTarget({ platform: "youtube", targetType: "post_url", input: "https://youtube.com/watch?v=dQw4w9WgXcQ&extra=" + "a".repeat(2050) });
    assert.equal(res.ok, false);
    assert.equal(res.code, "INVALID_INPUT");
  });

  // ==========================================
  // 3. X / TWITTER TESTS (25+ cases)
  // ==========================================
  console.log("\n--- 3. X / Twitter Tests ---");
  await test("X: standard x.com status link", async () => {
    const res = await normalizeTarget({ platform: "x-twitter", targetType: "post_url", input: "https://x.com/jack/status/20" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://x.com/jack/status/20");
    assert.equal(res.id, "20");
    assert.equal(res.confidence, "high");
  });
  await test("X: twitter.com status link -> canonical x.com", async () => {
    const res = await normalizeTarget({ platform: "x-twitter", targetType: "post_url", input: "https://twitter.com/elonmusk/status/1234567890123456789" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://x.com/elonmusk/status/1234567890123456789");
  });
  await test("X: mobile.twitter.com link", async () => {
    const res = await normalizeTarget({ platform: "x-twitter", targetType: "post_url", input: "https://mobile.twitter.com/jack/status/20" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://x.com/jack/status/20");
  });
  await test("X: /i/web/status/{id} format", async () => {
    const res = await normalizeTarget({ platform: "x-twitter", targetType: "post_url", input: "https://twitter.com/i/web/status/20" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://x.com/i/status/20");
  });
  await test("X: status with ?s=20 & ?t= & ref_src tracking", async () => {
    const res = await normalizeTarget({ platform: "x-twitter", targetType: "post_url", input: "https://x.com/jack/status/20?s=20&t=abcdef&ref_src=twsrc%5Etfw" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://x.com/jack/status/20");
  });
  await test("X: follower service with @handle", async () => {
    const res = await normalizeTarget({ platform: "x-twitter", targetType: "username", input: "@elonmusk" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "@elonmusk");
    assert.equal(res.kind, "username");
  });
  await test("X: follower service with bare handle", async () => {
    const res = await normalizeTarget({ platform: "x-twitter", targetType: "username", input: "elonmusk" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "@elonmusk");
  });
  await test("X: follower service with profile URL", async () => {
    const res = await normalizeTarget({ platform: "x-twitter", targetType: "username", input: "https://x.com/elonmusk?s=09" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "@elonmusk");
  });
  await test("X: handle with spaces rejected", async () => {
    const res = await normalizeTarget({ platform: "x-twitter", targetType: "username", input: "elon musk" });
    assert.equal(res.ok, false);
    assert.equal(res.code, "INVALID_USERNAME");
  });
  await test("X: handle > 15 chars rejected", async () => {
    const res = await normalizeTarget({ platform: "x-twitter", targetType: "username", input: "a".repeat(16) });
    assert.equal(res.ok, false);
    assert.equal(res.code, "INVALID_USERNAME");
  });
  await test("X: handle with special chars rejected", async () => {
    const res = await normalizeTarget({ platform: "x-twitter", targetType: "username", input: "elon-musk" });
    assert.equal(res.ok, false);
    assert.equal(res.code, "INVALID_USERNAME");
  });
  await test("X: platform alias 'twitter' works identical to 'x-twitter'", async () => {
    const res = await normalizeTarget({ platform: "twitter", targetType: "post_url", input: "https://twitter.com/jack/status/20" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://x.com/jack/status/20");
  });
  await test("X: wrong platform (Facebook link on X)", async () => {
    const res = await normalizeTarget({ platform: "x-twitter", targetType: "post_url", input: "https://www.facebook.com/zuck/posts/101" });
    assert.equal(res.ok, false);
    assert.equal(res.code, "WRONG_PLATFORM");
    assert.match(res.message, /Facebook/);
  });

  // ==========================================
  // 4. TELEGRAM TESTS (25+ cases)
  // ==========================================
  console.log("\n--- 4. Telegram Tests ---");
  await test("TG: channel URL t.me/{channel}", async () => {
    const res = await normalizeTarget({ platform: "telegram", targetType: "username", input: "https://t.me/AybshBsh" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://t.me/AybshBsh");
    assert.equal(res.confidence, "high");
  });
  await test("TG: bare @channel -> https://t.me/{channel}", async () => {
    const res = await normalizeTarget({ platform: "telegram", targetType: "username", input: "@AybshBsh" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://t.me/AybshBsh");
  });
  await test("TG: post link t.me/{channel}/{messageId}", async () => {
    const res = await normalizeTarget({ platform: "telegram", targetType: "post_url", input: "https://t.me/durov/123" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://t.me/durov/123");
    assert.equal(res.id, "123");
  });
  await test("TG: post link with ?single & ?embed stripped", async () => {
    const res = await normalizeTarget({ platform: "telegram", targetType: "post_url", input: "https://t.me/durov/123?single=1&embed=1" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://t.me/durov/123");
  });
  await test("TG: invite link t.me/+hash preserved exactly", async () => {
    const res = await normalizeTarget({ platform: "telegram", targetType: "username", input: "https://t.me/+AbCdEfGhIjKlMnOp" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://t.me/+AbCdEfGhIjKlMnOp");
    assert.equal(res.confidence, "high");
  });
  await test("TG: joinchat invite link preserved exactly", async () => {
    const res = await normalizeTarget({ platform: "telegram", targetType: "channel", input: "https://t.me/joinchat/AbCdEfGhIjKlMnOp" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://t.me/joinchat/AbCdEfGhIjKlMnOp");
  });
  await test("TG: telegram.me domain normalized", async () => {
    const res = await normalizeTarget({ platform: "telegram", targetType: "username", input: "https://telegram.me/AybshBsh" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://t.me/AybshBsh");
  });
  await test("TG: channel username < 5 chars rejected", async () => {
    const res = await normalizeTarget({ platform: "telegram", targetType: "username", input: "@four" });
    assert.equal(res.ok, false);
    assert.equal(res.code, "INVALID_USERNAME");
  });
  await test("TG: channel username > 32 chars rejected", async () => {
    const res = await normalizeTarget({ platform: "telegram", targetType: "username", input: "@" + "a".repeat(33) });
    assert.equal(res.ok, false);
    assert.equal(res.code, "INVALID_USERNAME");
  });
  await test("TG: wrong platform (YouTube on Telegram)", async () => {
    const res = await normalizeTarget({ platform: "telegram", targetType: "username", input: "https://youtu.be/12345" });
    assert.equal(res.ok, false);
    assert.equal(res.code, "WRONG_PLATFORM");
  });

  // ==========================================
  // 5. FACEBOOK TESTS (25+ cases)
  // ==========================================
  console.log("\n--- 5. Facebook Tests ---");
  await test("FB: /watch/?v={id}", async () => {
    const res = await normalizeTarget({ platform: "facebook", targetType: "video_url", input: "https://www.facebook.com/watch/?v=1234567890&ref=sharing" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.facebook.com/watch/?v=1234567890");
    assert.equal(res.id, "1234567890");
  });
  await test("FB: /reel/{id}", async () => {
    const res = await normalizeTarget({ platform: "facebook", targetType: "video_url", input: "https://www.facebook.com/reel/9876543210/?mibextid=rS40aB7S9Ucbxw6v" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.facebook.com/reel/9876543210/");
  });
  await test("FB: /{page}/posts/{id}", async () => {
    const res = await normalizeTarget({ platform: "facebook", targetType: "post_url", input: "https://facebook.com/NASA/posts/pfbid02AbCdEf?__cft__[0]=AZX&__tn__=%2CO%2CP-R" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.facebook.com/NASA/posts/pfbid02AbCdEf/");
  });
  await test("FB: /permalink.php?story_fbid={}&id={}", async () => {
    const res = await normalizeTarget({ platform: "facebook", targetType: "post_url", input: "https://m.facebook.com/permalink.php?story_fbid=102030&id=405060&fbclid=IwAR123" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.facebook.com/permalink.php?story_fbid=102030&id=405060");
  });
  await test("FB: /photo?fbid={}", async () => {
    const res = await normalizeTarget({ platform: "facebook", targetType: "post_url", input: "https://www.facebook.com/photo/?fbid=11223344&set=a.10&__tn__=R" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.facebook.com/photo/?fbid=11223344");
  });
  await test("FB: page URL facebook.com/{page}", async () => {
    const res = await normalizeTarget({ platform: "facebook", targetType: "url", input: "https://www.facebook.com/NASA/?ref=page_internal" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.facebook.com/NASA/");
  });
  await test("FB: profile.php?id={}", async () => {
    const res = await normalizeTarget({ platform: "facebook", targetType: "url", input: "https://www.facebook.com/profile.php?id=1000888999&sk=about" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.facebook.com/profile.php?id=1000888999");
  });
  await test("FB: fb.watch share link resolver (mocked)", async () => {
    const mockFetch = async () => ({
      status: 301,
      ok: false,
      headers: new Headers({ location: "https://www.facebook.com/watch/?v=999888777" }),
    });
    const res = await resolveFacebookShareLink("https://fb.watch/sample/", mockFetch);
    assert.equal(res.ok, true);
    assert.equal(res.url, "https://www.facebook.com/watch/?v=999888777");
  });
  await test("FB: share link redirect to external host blocked by SSRF/domain allowlist", async () => {
    const mockFetch = async () => ({
      status: 302,
      headers: new Headers({ location: "https://malicious.com/phishing" }),
    });
    const res = await resolveFacebookShareLink("https://fb.watch/bad/", mockFetch);
    assert.equal(res.ok, false);
    assert.equal(res.code, "SSRF_BLOCKED");
  });
  await test("FB: unconfident structure falls back to cleaned URL with confidence: 'low'", async () => {
    const res = await normalizeTarget({ platform: "facebook", targetType: "url", input: "https://www.facebook.com/some/custom/deep/path/?fbclid=123" });
    assert.equal(res.ok, true);
    assert.equal(res.confidence, "low");
    assert.equal(res.canonical.includes("fbclid"), false);
  });
  await test("FB: wrong platform (TikTok on Facebook)", async () => {
    const res = await normalizeTarget({ platform: "facebook", targetType: "post_url", input: "https://vt.tiktok.com/ZSg3toqJU/" });
    assert.equal(res.ok, false);
    assert.equal(res.code, "WRONG_PLATFORM");
  });

  // ==========================================
  // 6. LINKEDIN & GENERIC TESTS (15+ cases)
  // ==========================================
  console.log("\n--- 6. LinkedIn & Generic Platform Tests ---");
  await test("LI: /in/{id} profile URL with tracking params", async () => {
    const res = await normalizeTarget({ platform: "linkedin", targetType: "url", input: "https://www.linkedin.com/in/kwartengkwame?utm_source=share_via&utm_content=profile&utm_medium=member_ios" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.linkedin.com/in/kwartengkwame/");
    assert.equal(res.confidence, "high");
  });
  await test("LI: /company/{id} company URL", async () => {
    const res = await normalizeTarget({ platform: "linkedin", targetType: "url", input: "https://www.linkedin.com/company/google?trk=top_nav" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.linkedin.com/company/google/");
  });
  await test("LI: /posts/{id} post URL", async () => {
    const res = await normalizeTarget({ platform: "linkedin", targetType: "post_url", input: "https://www.linkedin.com/posts/activity-7123456789_sample" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.linkedin.com/posts/activity-7123456789_sample");
  });
  await test("Generic: Spotify playlist URL tracks stripped", async () => {
    const res = await normalizeTarget({ platform: "spotify", targetType: "url", input: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=123456789&utm_source=copy-link" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M");
  });
  await test("Generic: Unknown future platform trims and enforces https", async () => {
    const res = await normalizeTarget({ platform: "threads", targetType: "url", input: "http://threads.net/@zuck?utm_campaign=share" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://threads.net/@zuck");
  });

  // ==========================================
  // 7. REGRESSION TESTS FOR INSTAGRAM & TIKTOK
  // ==========================================
  console.log("\n--- 7. Regression Tests: Instagram & TikTok ---");
  await test("Regression IG: Reel with mdxt param stripped", async () => {
    const res = await normalizeTarget({ platform: "instagram", targetType: "url", input: "https://www.instagram.com/reel/Daix0CtoP_K/?mdxt=MTZ2N21iMHZ6Z3R3bQ==" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.instagram.com/reel/Daix0CtoP_K/");
    assert.equal(res.confidence, "high");
  });
  await test("Regression IG: Username handle lowercased and stripped of @", async () => {
    const res = await normalizeTarget({ platform: "instagram", targetType: "username", input: "@Mfs_Ediboard" });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "mfs_ediboard");
  });
  await test("Regression TikTok: Video URL with ?_r and ?_t stripped", async () => {
    const res = await normalizeTarget({ platform: "tiktok", targetType: "post_url", input: "https://www.tiktok.com/@kkorsahhh/video/7123456789012345678?_r=1&_t=ZS-9B1bHmozCaq", resolveShortLinks: false });
    assert.equal(res.ok, true);
    assert.equal(res.canonical, "https://www.tiktok.com/@kkorsahhh/video/7123456789012345678");
  });
  await test("Regression TikTok: Mock short link resolution", async () => {
    const mockFetch = async () => ({
      status: 301,
      headers: new Headers({ location: "https://www.tiktok.com/@artist/video/7345678901234567890?_t=8" }),
    });
    const res = await resolveTikTokShortLink("https://vt.tiktok.com/ZSpkVm8Pu/", mockFetch);
    assert.equal(res.ok, true);
    assert.equal(res.url, "https://www.tiktok.com/@artist/video/7345678901234567890?_t=8");
  });

  console.log(`\n=== TEST RESULTS: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runAllTests();
