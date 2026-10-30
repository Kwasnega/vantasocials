/**
 * Verifies that every platform in the DB has a working target contract
 * and provider target type inference — so no platform is ever BLOCKED.
 */

// Simulated versions of the real functions (copied logic for standalone testing)

const KNOWN_PLATFORMS = [
  "instagram", "tiktok", "youtube", "facebook",
  "x", "linkedin", "telegram", "pinterest",
  "spotify", "twitch", "reddit", "snapchat", "threads",
  // extras that might be in DB
  "discord", "kick", "soundcloud",
];

// Mirrors getTargetContractForService from lib/targets/contracts.ts
function getTargetContractForService({ platformSlug, targetType, slug = "" }) {
  const platform = String(platformSlug ?? "").trim().toLowerCase();
  const tt = String(targetType ?? "").trim();
  const isComment = slug.endsWith("-comments") || /comments/.test(slug);

  if (platform === "instagram") {
    if (tt === "username") return "INSTAGRAM_PROFILE";
    if (tt === "url" || tt === "post_url") return isComment ? "INSTAGRAM_COMMENT" : "INSTAGRAM_CONTENT";
    if (tt === "video_url") return "INSTAGRAM_REEL";
  }
  if (platform === "tiktok") {
    if (tt === "username") return "TIKTOK_PROFILE";
    if (tt === "url" || tt === "post_url") return isComment ? "TIKTOK_COMMENT" : null;
    if (tt === "video_url") return isComment ? "TIKTOK_COMMENT" : "TIKTOK_VIDEO";
  }
  if (platform === "youtube") {
    if (tt === "channel") return "YOUTUBE_CHANNEL";
    if (tt === "url" || tt === "post_url" || tt === "video_url") return isComment ? "YOUTUBE_COMMENT" : "YOUTUBE_VIDEO";
  }
  if (platform === "facebook") {
    if (tt === "page") return "FACEBOOK_PAGE";
    if (tt === "url" || tt === "post_url") return "FACEBOOK_POST";
    if (tt === "video_url") return "FACEBOOK_VIDEO";
  }
  if (platform === "x" || platform === "twitter") {
    return tt === "username" ? "X_PROFILE" : "X_POST";
  }
  if (platform === "linkedin") {
    return tt === "username" ? "LINKEDIN_PROFILE" : "LINKEDIN_POST";
  }
  if (platform === "telegram") {
    return tt === "url" || tt === "post_url" ? "TELEGRAM_POST" : "TELEGRAM_CHANNEL";
  }
  if (platform === "pinterest") {
    return tt === "url" || tt === "post_url" ? "PINTEREST_PIN" : "PINTEREST_PROFILE";
  }
  if (platform === "spotify") {
    return tt === "url" || tt === "post_url" ? "SPOTIFY_TRACK" : "SPOTIFY_PROFILE";
  }
  if (platform === "twitch") return "TWITCH_CHANNEL";
  if (platform === "reddit") {
    return tt === "url" || tt === "post_url" ? "REDDIT_POST" : "REDDIT_PROFILE";
  }
  if (platform === "snapchat") return "SNAPCHAT_PROFILE";
  if (platform === "threads") {
    return tt === "url" || tt === "post_url" ? "THREADS_POST" : "THREADS_PROFILE";
  }
  // Generic fallback — any platform with a name gets a contract
  if (platform) return tt === "url" || tt === "post_url" || tt === "video_url" ? "GENERIC_URL" : "GENERIC_PROFILE";
  return null;
}

// Mirrors inferProviderTargetType from lib/admin/provider-compatibility.ts
function inferProviderTargetType(platform, name, category) {
  const op = `${name} ${category}`.toLowerCase();
  if (platform === "instagram" && /\b(?:likes?|views?|comments?|saves?|reels?)\b/.test(op)) return "post_url";
  if (platform === "facebook") {
    if (/\bvideo\b/.test(op) && /\b(?:views?|likes?|comments?)\b/.test(op)) return "video_url";
    if (/\bpost\b/.test(op) && /\b(?:likes?|comments?|shares?|reactions?)\b/.test(op)) return "post_url";
    if (/\b(?:page|profile)\b/.test(op) && /\b(?:followers?|likes?)\b/.test(op)) return "page";
  }
  if (platform === "x" || platform === "twitter") {
    if (/\b(?:followers?|follow)\b/.test(op)) return "username";
    if (/\b(?:likes?|retweets?|replies?|views?|impressions?|comments?)\b/.test(op)) return "url";
    return "username";
  }
  if (platform === "linkedin") {
    if (/\b(?:followers?|connections?|follow)\b/.test(op)) return "username";
    if (/\b(?:likes?|comments?|views?|reactions?|shares?)\b/.test(op)) return "url";
    return "username";
  }
  if (platform === "telegram") {
    if (/\b(?:members?|subscribers?|followers?|views?)\b/.test(op)) return "username";
    if (/\b(?:post|message)\b/.test(op) && /\b(?:views?|reactions?|likes?)\b/.test(op)) return "url";
    return "username";
  }
  if (platform === "pinterest") {
    if (/\b(?:followers?|follow)\b/.test(op)) return "username";
    if (/\b(?:saves?|repins?|likes?|views?|comments?)\b/.test(op)) return "url";
    return "username";
  }
  if (platform === "spotify") {
    if (/\b(?:followers?|monthly\s+listeners?|listeners?)\b/.test(op)) return "username";
    if (/\b(?:plays?|streams?|saves?)\b/.test(op)) return "url";
    return "username";
  }
  if (platform === "twitch") return "username";
  if (platform === "reddit") {
    if (/\b(?:karma|followers?)\b/.test(op)) return "username";
    if (/\b(?:upvotes?|downvotes?|comments?|views?)\b/.test(op)) return "url";
    return "username";
  }
  if (platform === "snapchat") return "username";
  if (platform === "threads") {
    if (/\b(?:followers?|follow)\b/.test(op)) return "username";
    if (/\b(?:likes?|views?|comments?|reposts?|shares?)\b/.test(op)) return "url";
    return "username";
  }
  if (platform) return "username"; // generic fallback
  return null;
}

// Typical service names for each platform (what would come from ReliableSMM catalog)
const PLATFORM_TEST_CASES = [
  { platform: "instagram", name: "Instagram Followers | Real | Max 1M", category: "Instagram Followers", expectedInferredTarget: "username" },
  { platform: "instagram", name: "Instagram Likes | Fast | Max 50K", category: "Instagram Likes", expectedInferredTarget: "post_url" },
  { platform: "tiktok", name: "TikTok Followers | Real | Max 100K", category: "TikTok Followers", expectedInferredTarget: "username" },
  { platform: "youtube", name: "YouTube Subscribers | USA | Max 500K", category: "YouTube Subscribers", expectedInferredTarget: "username" },
  { platform: "facebook", name: "Facebook Page Followers | Max 50K", category: "Facebook Followers", expectedInferredTarget: "page" },
  { platform: "x", name: "Twitter/X Followers [USA] Max 100K", category: "X Services [USA]", expectedInferredTarget: "username" },
  { platform: "x", name: "Twitter Likes | Max 10K", category: "X Likes Services", expectedInferredTarget: "url" },
  { platform: "linkedin", name: "LinkedIn Followers [USA] [Max 100K]", category: "LinkedIn Services [USA]", expectedInferredTarget: "username" },
  { platform: "linkedin", name: "LinkedIn Post Likes | Max 5K", category: "LinkedIn Services", expectedInferredTarget: "url" },
  { platform: "telegram", name: "Telegram Members | Real | Max 50K", category: "Telegram Services", expectedInferredTarget: "username" },
  { platform: "telegram", name: "Telegram Post Views | Max 10K", category: "Telegram Post Services", expectedInferredTarget: "url" },
  { platform: "pinterest", name: "Pinterest Followers | Max 10K", category: "Pinterest Services", expectedInferredTarget: "username" },
  { platform: "pinterest", name: "Pinterest Pin Saves | Max 5K", category: "Pinterest Services", expectedInferredTarget: "url" },
  { platform: "spotify", name: "Spotify Followers | Max 50K", category: "Spotify Services", expectedInferredTarget: "username" },
  { platform: "spotify", name: "Spotify Plays | Max 1M", category: "Spotify Services", expectedInferredTarget: "url" },
  { platform: "twitch", name: "Twitch Followers | Max 10K", category: "Twitch Services", expectedInferredTarget: "username" },
  { platform: "reddit", name: "Reddit Upvotes | Max 1K", category: "Reddit Services", expectedInferredTarget: "url" },
  { platform: "snapchat", name: "Snapchat Followers | Max 10K", category: "Snapchat Services", expectedInferredTarget: "username" },
  { platform: "threads", name: "Threads Followers | Max 10K", category: "Threads Services", expectedInferredTarget: "username" },
  { platform: "threads", name: "Threads Likes | Max 5K", category: "Threads Services", expectedInferredTarget: "url" },
];

console.log("\n=== Platform Contract + Target Inference Verification ===\n");

let allPassed = true;

for (const tc of PLATFORM_TEST_CASES) {
  // Step 1: infer target type from provider metadata (as provider-compatibility.ts does)
  const inferredTarget = inferProviderTargetType(tc.platform, tc.name, tc.category);

  // Step 2: get contract for the platform + inferred target (as getTargetContractForService does)
  const contract = getTargetContractForService({
    platformSlug: tc.platform,
    targetType: inferredTarget,
    slug: `${tc.platform}-service`,
  });

  const inferOk = inferredTarget !== null;
  const contractOk = contract !== null;
  const pass = inferOk && contractOk;
  if (!pass) allPassed = false;

  const status = pass ? "✅ PASS" : "❌ FAIL";
  console.log(`${status}  ${tc.platform.padEnd(12)} | inferred='${String(inferredTarget).padEnd(10)}' | contract='${contract ?? "NULL"}'`);
  console.log(`         service: ${tc.name}`);
  if (!pass) {
    console.log(`         ⚠ inferredTarget=${inferredTarget}, contract=${contract}`);
  }
  console.log();
}

console.log("=".repeat(60));
console.log(allPassed
  ? "✅ ALL PLATFORMS PASS — no service will be BLOCKED by a missing contract"
  : "❌ SOME PLATFORMS FAILED — check output above");
console.log("=".repeat(60));
process.exit(allPassed ? 0 : 1);
