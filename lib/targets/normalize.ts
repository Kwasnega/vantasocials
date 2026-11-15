export type TargetResolvers = {
  resolveTikTok?: (url: string) => Promise<{ ok: true; url: string } | { ok: false; code: "RESOLUTION_FAILED" | "SSRF_BLOCKED"; message: string }>;
  resolveFacebook?: (url: string) => Promise<{ ok: true; url: string } | { ok: false; code: "RESOLUTION_FAILED" | "SSRF_BLOCKED"; message: string }>;
};

export type TargetConfidence = "high" | "low";

export type NormalizeTargetOptions = {
  platform: string;
  targetType: string;
  input: string;
  resolveShortLinks?: boolean;
};

export type NormalizeTargetResult =
  | {
      ok: true;
      canonical: string;
      kind: "url" | "username";
      id?: string;
      confidence: TargetConfidence;
    }
  | {
      ok: false;
      code:
        | "INVALID_INPUT"
        | "WRONG_PLATFORM"
        | "INVALID_USERNAME"
        | "INVALID_URL"
        | "RESOLUTION_FAILED"
        | "SSRF_BLOCKED";
      message: string;
    };

// Platform human-readable display names
export const PLATFORM_DISPLAY_NAMES: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook",
  "x-twitter": "X / Twitter",
  twitter: "X / Twitter",
  telegram: "Telegram",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  spotify: "Spotify",
};

// Known domains per platform for cross-platform checking
export const PLATFORM_DOMAINS: Record<string, string[]> = {
  instagram: ["instagram.com", "instagr.am"],
  tiktok: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"],
  youtube: ["youtube.com", "youtu.be", "music.youtube.com"],
  facebook: ["facebook.com", "fb.watch", "fb.com", "m.facebook.com"],
  "x-twitter": ["x.com", "twitter.com", "t.co"],
  twitter: ["x.com", "twitter.com", "t.co"],
  telegram: ["t.me", "telegram.me", "telegram.dog"],
  linkedin: ["linkedin.com", "lnkd.in"],
  pinterest: ["pinterest.com", "pin.it"],
  spotify: ["spotify.com", "open.spotify.com"],
};

/**
 * Checks if a given input appears to be a link belonging to a different platform.
 */
export function checkPlatformMismatch(input: string, expectedPlatform: string): { mismatch: boolean; detectedPlatform?: string } {
  const normExpected = expectedPlatform.toLowerCase().trim();
  let hostname = "";
  try {
    const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    const url = new URL(withProtocol);
    hostname = url.hostname.toLowerCase();
  } catch {
    return { mismatch: false };
  }

  for (const [platform, domains] of Object.entries(PLATFORM_DOMAINS)) {
    const isThisDomain = domains.some((d) => hostname === d || hostname.endsWith(`.${d}`));
    if (isThisDomain) {
      const isExpected =
        platform === normExpected ||
        ((normExpected === "x-twitter" || normExpected === "twitter") && (platform === "x-twitter" || platform === "twitter"));
      if (!isExpected) {
        return {
          mismatch: true,
          detectedPlatform: PLATFORM_DISPLAY_NAMES[platform] ?? platform,
        };
      }
      return { mismatch: false };
    }
  }

  return { mismatch: false };
}

// Known global tracking parameters to strip across all platforms
const GLOBAL_TRACKING_PARAMS = [
  "fbclid",
  "gclid",
  "igsh",
  "igshid",
  "si",
  "s",
  "ref",
  "ref_src",
  "mibextid",
  "_branch_match_id",
  "cplk",
  "mdxt",
  "psln",
  "srtk",
  "sender_device",
  "is_from_webapp",
  "_r",
  "_t",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_brand",
  "utm_social",
  "utm_source_platform",
  "feature",
  "pp",
  "embeds_referring_euri",
  "source_ve_path",
];

function stripTrackingParams(url: URL): void {
  for (const param of Array.from(url.searchParams.keys())) {
    const lower = param.toLowerCase();
    if (
      lower.startsWith("utm_") ||
      lower.startsWith("__cft") ||
      lower.startsWith("__tn") ||
      GLOBAL_TRACKING_PARAMS.includes(lower)
    ) {
      url.searchParams.delete(param);
    }
  }
}

/**
 * Normalizes username inputs (for follower/profile visit services).
 */
function normalizeUsername(input: string, platform: string): NormalizeTargetResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, code: "INVALID_INPUT", message: "Username cannot be empty." };
  }

  // Reject URLs pasted in the username field
  if (/^https?:\/\//i.test(trimmed) || trimmed.includes("/") || trimmed.includes(".com") || trimmed.includes(".net")) {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      const url = new URL(withProtocol);
      const host = url.hostname.toLowerCase();
      if (platform === "instagram" && (host === "instagram.com" || host.endsWith(".instagram.com"))) {
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length > 0 && !["p", "reel", "reels", "tv", "stories", "explore"].includes(parts[0].toLowerCase())) {
          return normalizeUsername(parts[0], platform);
        }
      } else if (platform === "tiktok" && (host === "tiktok.com" || host.endsWith(".tiktok.com"))) {
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length > 0 && parts[0].startsWith("@")) {
          return normalizeUsername(parts[0].slice(1), platform);
        }
      } else if ((platform === "x-twitter" || platform === "twitter") && (host === "x.com" || host === "twitter.com")) {
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length > 0 && !["status", "i", "explore", "home"].includes(parts[0].toLowerCase())) {
          return normalizeUsername(parts[0], "twitter");
        }
      } else if (platform === "telegram" && (host === "t.me" || host === "telegram.me")) {
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length > 0 && !parts[0].startsWith("+")) {
          return normalizeUsername(parts[0], "telegram");
        }
      }
    } catch {
      // not a valid URL
    }
    return {
      ok: false,
      code: "INVALID_USERNAME",
      message: "Please enter a username or handle without URLs or slashes (e.g. creator).",
    };
  }

  // Reject spaces
  if (/\s/.test(trimmed)) {
    return {
      ok: false,
      code: "INVALID_USERNAME",
      message: "Usernames cannot contain spaces. Please enter a valid handle.",
    };
  }

  // Strip leading @
  let handle = trimmed.startsWith("@") ? trimmed.slice(1).trim() : trimmed;

  if (platform === "instagram") {
    handle = handle.toLowerCase();
    if (handle.length < 1 || handle.length > 30) {
      return { ok: false, code: "INVALID_USERNAME", message: "Instagram username must be between 1 and 30 characters." };
    }
    if (!/^[a-z0-9._]+$/.test(handle)) {
      return { ok: false, code: "INVALID_USERNAME", message: "Instagram username can only contain letters, numbers, periods, and underscores." };
    }
    if (handle.startsWith(".") || handle.endsWith(".")) {
      return { ok: false, code: "INVALID_USERNAME", message: "Instagram username cannot start or end with a period." };
    }
    return { ok: true, canonical: handle, kind: "username", id: handle, confidence: "high" };
  }

  if (platform === "tiktok") {
    if (handle.length < 2 || handle.length > 24) {
      return { ok: false, code: "INVALID_USERNAME", message: "TikTok username must be between 2 and 24 characters." };
    }
    if (!/^[a-zA-Z0-9_.]+$/.test(handle)) {
      return { ok: false, code: "INVALID_USERNAME", message: "TikTok username can only contain letters, numbers, underscores, and periods." };
    }
    if (handle.endsWith(".")) {
      return { ok: false, code: "INVALID_USERNAME", message: "TikTok username cannot end with a period." };
    }
    return { ok: true, canonical: handle, kind: "username", id: handle, confidence: "high" };
  }

  if (platform === "x-twitter" || platform === "twitter") {
    // X handles: 1-15 chars, alphanumeric & underscore
    if (handle.length < 1 || handle.length > 15) {
      return { ok: false, code: "INVALID_USERNAME", message: "X / Twitter username must be between 1 and 15 characters." };
    }
    if (!/^[a-zA-Z0-9_]+$/.test(handle)) {
      return { ok: false, code: "INVALID_USERNAME", message: "X / Twitter username can only contain letters, numbers, and underscores." };
    }
    return { ok: true, canonical: `@${handle}`, kind: "username", id: handle, confidence: "high" };
  }

  if (platform === "telegram") {
    // Telegram channel/user handles: 5-32 chars, letters, digits, underscore
    if (handle.length < 5 || handle.length > 32) {
      return { ok: false, code: "INVALID_USERNAME", message: "Telegram channel username must be between 5 and 32 characters." };
    }
    if (!/^[a-zA-Z0-9_]+$/.test(handle)) {
      return { ok: false, code: "INVALID_USERNAME", message: "Telegram channel username can only contain letters, numbers, and underscores." };
    }
    // ReliableSMM accepts https://t.me/channel
    return { ok: true, canonical: `https://t.me/${handle}`, kind: "username", id: handle, confidence: "high" };
  }

  return { ok: true, canonical: handle, kind: "username", id: handle, confidence: "high" };
}

// ==========================================
// PLATFORM SPECIFIC NORMALIZERS
// ==========================================

/**
 * 1. YouTube Normalizer
 * Video: https://www.youtube.com/watch?v={id} (VERIFIED provider format)
 * Subscriber/Channel: https://www.youtube.com/@{handle} or /channel/{id}
 */
function normalizeYouTube(input: string, targetType: string): NormalizeTargetResult {
  const trimmed = input.trim();

  // If user pasted bare @handle directly into channel or subscriber field
  if (trimmed.startsWith("@") && !trimmed.includes("/")) {
    const handle = trimmed.slice(1);
    if (/^[a-zA-Z0-9_.-]+$/.test(handle)) {
      return {
        ok: true,
        canonical: `https://www.youtube.com/@${handle}`,
        kind: "url",
        id: handle,
        confidence: "high",
      };
    }
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return { ok: false, code: "INVALID_URL", message: "Please enter a valid YouTube URL." };
  }

  const hostname = parsed.hostname.toLowerCase();
  const isYtDomain = PLATFORM_DOMAINS.youtube.some((d) => hostname === d || hostname.endsWith(`.${d}`));

  if (!isYtDomain) {
    const mismatch = checkPlatformMismatch(input, "youtube");
    if (mismatch.mismatch) {
      return { ok: false, code: "WRONG_PLATFORM", message: `This looks like a ${mismatch.detectedPlatform} link, but you selected YouTube.` };
    }
    return { ok: false, code: "INVALID_URL", message: "Please enter a valid YouTube URL." };
  }

  // Video ID format: 11 chars [A-Za-z0-9_-]
  const videoIdRegex = /^[A-Za-z0-9_-]{11}$/;

  // Check youtu.be/ID
  if (hostname === "youtu.be") {
    const videoId = parsed.pathname.slice(1).split("/")[0];
    if (videoId && videoIdRegex.test(videoId)) {
      return {
        ok: true,
        canonical: `https://www.youtube.com/watch?v=${videoId}`,
        kind: "url",
        id: videoId,
        confidence: "high",
      };
    }
  }

  // Check /watch?v=ID
  if (parsed.pathname === "/watch") {
    const videoId = parsed.searchParams.get("v");
    if (videoId && videoIdRegex.test(videoId)) {
      return {
        ok: true,
        canonical: `https://www.youtube.com/watch?v=${videoId}`,
        kind: "url",
        id: videoId,
        confidence: "high",
      };
    }
  }

  // Check /shorts/ID, /live/ID, /embed/ID
  const specialMatch = parsed.pathname.match(/\/(shorts|live|embed)\/([A-Za-z0-9_-]{11})/i);
  if (specialMatch) {
    const videoId = specialMatch[2];
    return {
      ok: true,
      canonical: `https://www.youtube.com/watch?v=${videoId}`,
      kind: "url",
      id: videoId,
      confidence: "high",
    };
  }

  // Subscriber / Channel URLs
  if (targetType === "channel" || targetType === "url" || targetType === "username") {
    // /@handle
    const handleMatch = parsed.pathname.match(/^\/@([A-Za-z0-9_.-]+)\/?$/);
    if (handleMatch) {
      return {
        ok: true,
        canonical: `https://www.youtube.com/@${handleMatch[1]}`,
        kind: "url",
        id: handleMatch[1],
        confidence: "high",
      };
    }

    // /channel/UC...
    const channelMatch = parsed.pathname.match(/^\/channel\/([A-Za-z0-9_-]+)\/?$/);
    if (channelMatch) {
      return {
        ok: true,
        canonical: `https://www.youtube.com/channel/${channelMatch[1]}`,
        kind: "url",
        id: channelMatch[1],
        confidence: "high",
      };
    }

    // /c/name or /user/name
    const cMatch = parsed.pathname.match(/^\/(c|user)\/([A-Za-z0-9_-]+)\/?$/);
    if (cMatch) {
      return {
        ok: true,
        canonical: `https://www.youtube.com/${cMatch[1]}/${cMatch[2]}`,
        kind: "url",
        id: cMatch[2],
        confidence: "high",
      };
    }
  }

  // If user pasted @handle directly
  if (trimmed.startsWith("@") && /^[a-zA-Z0-9_.-]+$/.test(trimmed.slice(1))) {
    return {
      ok: true,
      canonical: `https://www.youtube.com/${trimmed}`,
      kind: "url",
      id: trimmed.slice(1),
      confidence: "high",
    };
  }

  // Strip tracking and return clean fallback if unrecognized YouTube structure
  stripTrackingParams(parsed);
  parsed.hash = "";
  return {
    ok: true,
    canonical: parsed.toString(),
    kind: "url",
    confidence: "low",
  };
}

/**
 * 2. X / Twitter Normalizer
 * Status/Tweet: https://x.com/{user}/status/{id}
 * Followers/Profile: @handle
 */
function normalizeXTwitter(input: string, targetType: string): NormalizeTargetResult {
  const trimmed = input.trim();

  // If username target
  if (targetType === "username" && !trimmed.includes("/")) {
    return normalizeUsername(trimmed, "x-twitter");
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return { ok: false, code: "INVALID_URL", message: "Please enter a valid X / Twitter link." };
  }

  const hostname = parsed.hostname.toLowerCase();
  const isXDomain = PLATFORM_DOMAINS["x-twitter"].some((d) => hostname === d || hostname.endsWith(`.${d}`));

  if (!isXDomain) {
    const mismatch = checkPlatformMismatch(input, "x-twitter");
    if (mismatch.mismatch) {
      return { ok: false, code: "WRONG_PLATFORM", message: `This looks like a ${mismatch.detectedPlatform} link, but you selected X / Twitter.` };
    }
    return { ok: false, code: "INVALID_URL", message: "Please enter a valid X / Twitter URL." };
  }

  // /{user}/status/{id} or /i/web/status/{id}
  const statusMatch = parsed.pathname.match(/\/(?:i\/web\/status|([a-zA-Z0-9_]+)\/status)\/(\d+)/i);
  if (statusMatch) {
    const user = statusMatch[1] || "i";
    const statusId = statusMatch[2];
    return {
      ok: true,
      canonical: `https://x.com/${user}/status/${statusId}`,
      kind: "url",
      id: statusId,
      confidence: "high",
    };
  }

  // Profile URL
  const profileMatch = parsed.pathname.match(/^\/([a-zA-Z0-9_]{1,15})\/?$/);
  if (profileMatch && !["home", "explore", "notifications", "messages", "search"].includes(profileMatch[1].toLowerCase())) {
    const handle = profileMatch[1];
    if (targetType === "username") {
      return { ok: true, canonical: `@${handle}`, kind: "username", id: handle, confidence: "high" };
    }
    return {
      ok: true,
      canonical: `https://x.com/${handle}`,
      kind: "url",
      id: handle,
      confidence: "high",
    };
  }

  stripTrackingParams(parsed);
  parsed.hash = "";
  return {
    ok: true,
    canonical: parsed.toString(),
    kind: "url",
    confidence: "low",
  };
}

/**
 * 3. Telegram Normalizer
 * Channel/Subscriber: https://t.me/{channel}
 * Post: https://t.me/{channel}/{messageId}
 * Invite links: https://t.me/+hash or /joinchat/hash (PRESERVE EXACTLY)
 */
function normalizeTelegram(input: string, targetType: string): NormalizeTargetResult {
  const trimmed = input.trim();

  // If handle @channel
  if (trimmed.startsWith("@") && !trimmed.includes("/")) {
    return normalizeUsername(trimmed, "telegram");
  }

  // Invite links with + or joinchat (e.g. t.me/+abc12345 or t.me/joinchat/xyz)
  if (/^https?:\/\/(t\.me|telegram\.me)\/(\+[a-zA-Z0-9_-]+|joinchat\/[a-zA-Z0-9_-]+)/i.test(trimmed) || /^(t\.me|telegram\.me)\/(\+[a-zA-Z0-9_-]+|joinchat\/[a-zA-Z0-9_-]+)/i.test(trimmed)) {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      const parsed = new URL(withProtocol);
      stripTrackingParams(parsed);
      parsed.hash = "";
      return {
        ok: true,
        canonical: parsed.toString().replace(/\/$/, ""),
        kind: "url",
        confidence: "high",
      };
    } catch {
      // fallback
    }
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return { ok: false, code: "INVALID_URL", message: "Please enter a valid Telegram link." };
  }

  const hostname = parsed.hostname.toLowerCase();
  const isTgDomain = PLATFORM_DOMAINS.telegram.some((d) => hostname === d || hostname.endsWith(`.${d}`));

  if (!isTgDomain) {
    const mismatch = checkPlatformMismatch(input, "telegram");
    if (mismatch.mismatch) {
      return { ok: false, code: "WRONG_PLATFORM", message: `This looks like a ${mismatch.detectedPlatform} link, but you selected Telegram.` };
    }
    return { ok: false, code: "INVALID_URL", message: "Please enter a valid Telegram URL (e.g. https://t.me/channel)." };
  }

  // Post link: t.me/{channel}/{messageId}
  const postMatch = parsed.pathname.match(/^\/([a-zA-Z0-9_]{5,32})\/(\d+)\/?$/);
  if (postMatch) {
    return {
      ok: true,
      canonical: `https://t.me/${postMatch[1]}/${postMatch[2]}`,
      kind: "url",
      id: postMatch[2],
      confidence: "high",
    };
  }

  // Channel link: t.me/{channel}
  const channelMatch = parsed.pathname.match(/^\/([a-zA-Z0-9_]{5,32})\/?$/);
  if (channelMatch) {
    return {
      ok: true,
      canonical: `https://t.me/${channelMatch[1]}`,
      kind: targetType === "username" ? "username" : "url",
      id: channelMatch[1],
      confidence: "high",
    };
  }

  stripTrackingParams(parsed);
  parsed.hash = "";
  return {
    ok: true,
    canonical: parsed.toString(),
    kind: "url",
    confidence: "low",
  };
}

/**
 * 4. Facebook Normalizer
 * Conservative approach. Supports:
 * - /watch/?v=
 * - /reel/{id}
 * - /{page}/posts/{id}
 * - /permalink.php?story_fbid=&id=
 * - /photo?fbid=
 * - Share links (/share/p/..., /share/v/..., fb.watch/...) resolved via safe redirect
 * Preserves content identifiers, strips tracking parameters.
 */
async function normalizeFacebook(
  input: string,
  targetType: string,
  resolveShortLinks: boolean = true,
  resolvers?: TargetResolvers
): Promise<NormalizeTargetResult> {
  const trimmed = input.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return { ok: false, code: "INVALID_URL", message: "Please enter a valid Facebook URL." };
  }

  const hostname = parsed.hostname.toLowerCase();
  const isFbDomain = PLATFORM_DOMAINS.facebook.some((d) => hostname === d || hostname.endsWith(`.${d}`));

  if (!isFbDomain) {
    const mismatch = checkPlatformMismatch(input, "facebook");
    if (mismatch.mismatch) {
      return { ok: false, code: "WRONG_PLATFORM", message: `This looks like a ${mismatch.detectedPlatform} link, but you selected Facebook.` };
    }
    return { ok: false, code: "INVALID_URL", message: "Please enter a valid Facebook URL." };
  }

  // Check if it's a share link or fb.watch link that requires redirect resolution
  const isShareLink =
    hostname === "fb.watch" ||
    parsed.pathname.startsWith("/share/") ||
    parsed.pathname.startsWith("/shares/");

  let targetUrl = withProtocol;

  if (isShareLink) {
    if (!resolveShortLinks || !resolvers?.resolveFacebook) {
      stripTrackingParams(parsed);
      parsed.hash = "";
      return {
        ok: true,
        canonical: parsed.toString(),
        kind: "url",
        confidence: "low",
      };
    }

    const resolved = await resolvers.resolveFacebook(withProtocol);
    if (!resolved.ok) {
      return resolved;
    }
    targetUrl = resolved.url;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return { ok: false, code: "RESOLUTION_FAILED", message: "Failed to parse resolved Facebook URL." };
    }
  }

  // Strip fbclid, __cft__, __tn__, mibextid, ref, etc.
  stripTrackingParams(parsed);
  parsed.hash = "";

  // Normalize host to https://www.facebook.com
  const canonicalHost = "https://www.facebook.com";

  // Watch video: /watch/?v={id}
  if (parsed.pathname === "/watch" || parsed.pathname === "/watch/") {
    const videoId = parsed.searchParams.get("v");
    if (videoId) {
      return {
        ok: true,
        canonical: `${canonicalHost}/watch/?v=${videoId}`,
        kind: "url",
        id: videoId,
        confidence: "high",
      };
    }
  }

  // Reel: /reel/{id}
  const reelMatch = parsed.pathname.match(/\/reel\/(\d+)/i);
  if (reelMatch) {
    return {
      ok: true,
      canonical: `${canonicalHost}/reel/${reelMatch[1]}/`,
      kind: "url",
      id: reelMatch[1],
      confidence: "high",
    };
  }

  // Post: /{page}/posts/{id}
  const postMatch = parsed.pathname.match(/\/([a-zA-Z0-9_.-]+)\/posts\/(pfbid[a-zA-Z0-9]+|\d+)/i);
  if (postMatch) {
    return {
      ok: true,
      canonical: `${canonicalHost}/${postMatch[1]}/posts/${postMatch[2]}/`,
      kind: "url",
      id: postMatch[2],
      confidence: "high",
    };
  }

  // Permalink: /permalink.php?story_fbid={}&id={}
  if (parsed.pathname.includes("permalink.php")) {
    const storyFbid = parsed.searchParams.get("story_fbid");
    const id = parsed.searchParams.get("id");
    if (storyFbid && id) {
      return {
        ok: true,
        canonical: `${canonicalHost}/permalink.php?story_fbid=${storyFbid}&id=${id}`,
        kind: "url",
        id: storyFbid,
        confidence: "high",
      };
    }
  }

  // Photo: /photo/?fbid={} or /photo.php?fbid={}
  if (parsed.pathname.includes("photo")) {
    const fbid = parsed.searchParams.get("fbid");
    if (fbid) {
      return {
        ok: true,
        canonical: `${canonicalHost}/photo/?fbid=${fbid}`,
        kind: "url",
        id: fbid,
        confidence: "high",
      };
    }
  }

  // Page / Profile URL: /{page} or /profile.php?id={}
  if (parsed.pathname.includes("profile.php")) {
    const id = parsed.searchParams.get("id");
    if (id) {
      return {
        ok: true,
        canonical: `${canonicalHost}/profile.php?id=${id}`,
        kind: "url",
        id,
        confidence: "high",
      };
    }
  }

  const pageMatch = parsed.pathname.match(/^\/([a-zA-Z0-9_.-]{3,50})\/?$/);
  if (pageMatch && !["watch", "reel", "events", "groups", "marketplace", "gaming"].includes(pageMatch[1].toLowerCase())) {
    return {
      ok: true,
      canonical: `${canonicalHost}/${pageMatch[1]}/`,
      kind: "url",
      id: pageMatch[1],
      confidence: "high",
    };
  }

  // If cannot be confident, return cleaned URL with confidence: 'low'
  return {
    ok: true,
    canonical: parsed.toString(),
    kind: "url",
    confidence: "low",
  };
}

/**
 * 5. Instagram Normalizer (from prior verified work)
 */
function normalizeInstagram(input: string, targetType: string): NormalizeTargetResult {
  const trimmed = input.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return { ok: false, code: "INVALID_URL", message: "Please enter a valid Instagram URL." };
  }

  const hostname = parsed.hostname.toLowerCase();
  const isIgDomain = PLATFORM_DOMAINS.instagram.some((d) => hostname === d || hostname.endsWith(`.${d}`));

  if (!isIgDomain) {
    const mismatch = checkPlatformMismatch(input, "instagram");
    if (mismatch.mismatch) {
      return { ok: false, code: "WRONG_PLATFORM", message: `This looks like a ${mismatch.detectedPlatform} link, but you selected Instagram.` };
    }
    return { ok: false, code: "INVALID_URL", message: "Please enter a valid Instagram URL." };
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return { ok: false, code: "INVALID_URL", message: "The Instagram link is missing the post or profile path." };
  }

  let type: "p" | "reel" | "tv" | null = null;
  let shortcode: string | null = null;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i].toLowerCase();
    if (seg === "p" && i + 1 < segments.length) {
      type = "p";
      shortcode = segments[i + 1];
      break;
    }
    if ((seg === "reel" || seg === "reels") && i + 1 < segments.length) {
      type = "reel";
      shortcode = segments[i + 1];
      break;
    }
    if (seg === "tv" && i + 1 < segments.length) {
      type = "tv";
      shortcode = segments[i + 1];
      break;
    }
  }

  if (type && shortcode) {
    if (!/^[a-zA-Z0-9_-]+$/.test(shortcode)) {
      return { ok: false, code: "INVALID_URL", message: "The Instagram post shortcode contains invalid characters." };
    }
    return {
      ok: true,
      canonical: `https://www.instagram.com/${type}/${shortcode}/`,
      kind: "url",
      id: shortcode,
      confidence: "high",
    };
  }

  if (targetType === "username" || targetType === "channel" || targetType === "page") {
    const username = segments[0];
    if (username && !["explore", "stories", "accounts"].includes(username.toLowerCase())) {
      return normalizeUsername(username, "instagram");
    }
  }

  stripTrackingParams(parsed);
  parsed.hash = "";
  return {
    ok: true,
    canonical: parsed.toString(),
    kind: "url",
    confidence: "low",
  };
}

/**
 * 6. TikTok Normalizer (from prior verified work)
 */
async function normalizeTikTok(
  input: string,
  targetType: string,
  resolveShortLinks: boolean = true,
  resolvers?: TargetResolvers
): Promise<NormalizeTargetResult> {
  const trimmed = input.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return { ok: false, code: "INVALID_URL", message: "Please enter a valid TikTok URL." };
  }

  const hostname = parsed.hostname.toLowerCase();
  const isTikTokDomain = PLATFORM_DOMAINS.tiktok.some((d) => hostname === d || hostname.endsWith(`.${d}`));

  if (!isTikTokDomain) {
    const mismatch = checkPlatformMismatch(input, "tiktok");
    if (mismatch.mismatch) {
      return { ok: false, code: "WRONG_PLATFORM", message: `This looks like a ${mismatch.detectedPlatform} link, but you selected TikTok.` };
    }
    return { ok: false, code: "INVALID_URL", message: "Please enter a valid TikTok URL." };
  }

  const isShortLink =
    hostname === "vm.tiktok.com" ||
    hostname === "vt.tiktok.com" ||
    (hostname.endsWith("tiktok.com") && parsed.pathname.startsWith("/t/"));

  let targetUrl = withProtocol;

  if (isShortLink) {
    if (!resolveShortLinks || !resolvers?.resolveTikTok) {
      parsed.search = "";
      parsed.hash = "";
      return { ok: true, canonical: parsed.toString(), kind: "url", confidence: "high" };
    }

    const resolved = await resolvers.resolveTikTok(withProtocol);
    if (!resolved.ok) return resolved;
    targetUrl = resolved.url;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return { ok: false, code: "RESOLUTION_FAILED", message: "Failed to parse resolved TikTok URL." };
    }
  }

  const path = parsed.pathname;
  const videoMatch = path.match(/\/@([a-zA-Z0-9_.-]+)\/video\/(\d+)/i) || path.match(/\/v\/(\d+)/i);

  if (videoMatch) {
    if (videoMatch.length === 3) {
      const user = videoMatch[1];
      const videoId = videoMatch[2];
      return {
        ok: true,
        canonical: `https://www.tiktok.com/@${user}/video/${videoId}`,
        kind: "url",
        id: videoId,
        confidence: "high",
      };
    } else if (videoMatch.length === 2) {
      const videoId = videoMatch[1];
      return {
        ok: true,
        canonical: `https://www.tiktok.com/video/${videoId}`,
        kind: "url",
        id: videoId,
        confidence: "high",
      };
    }
  }

  const profileMatch = path.match(/^\/@([a-zA-Z0-9_.-]+)\/?$/);
  if (profileMatch) {
    const userRes = normalizeUsername(profileMatch[1], "tiktok");
    if (userRes.ok) {
      if (targetType === "username" || targetType === "channel" || targetType === "page") {
        return userRes;
      }
      return {
        ok: true,
        canonical: `https://www.tiktok.com/@${userRes.canonical}`,
        kind: "url",
        id: userRes.id,
        confidence: "high",
      };
    }
    return userRes;
  }

  stripTrackingParams(parsed);
  parsed.hash = "";
  return {
    ok: true,
    canonical: parsed.toString(),
    kind: "url",
    confidence: "low",
  };
}

/**
 * 7. LinkedIn Normalizer
 * Profile: https://www.linkedin.com/in/{id}
 * Post: https://www.linkedin.com/posts/{id}
 */
function normalizeLinkedIn(input: string, targetType: string): NormalizeTargetResult {
  const trimmed = input.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return { ok: false, code: "INVALID_URL", message: "Please enter a valid LinkedIn URL." };
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLinkedInDomain = PLATFORM_DOMAINS.linkedin.some((d) => hostname === d || hostname.endsWith(`.${d}`));

  if (!isLinkedInDomain) {
    const mismatch = checkPlatformMismatch(input, "linkedin");
    if (mismatch.mismatch) {
      return { ok: false, code: "WRONG_PLATFORM", message: `This looks like a ${mismatch.detectedPlatform} link, but you selected LinkedIn.` };
    }
    return { ok: false, code: "INVALID_URL", message: "Please enter a valid LinkedIn URL." };
  }

  stripTrackingParams(parsed);
  parsed.hash = "";

  // Profile: /in/{id}
  const inMatch = parsed.pathname.match(/\/in\/([a-zA-Z0-9_-]+)/i);
  if (inMatch) {
    return {
      ok: true,
      canonical: `https://www.linkedin.com/in/${inMatch[1]}/`,
      kind: "url",
      id: inMatch[1],
      confidence: "high",
    };
  }

  // Company: /company/{id}
  const compMatch = parsed.pathname.match(/\/company\/([a-zA-Z0-9_-]+)/i);
  if (compMatch) {
    return {
      ok: true,
      canonical: `https://www.linkedin.com/company/${compMatch[1]}/`,
      kind: "url",
      id: compMatch[1],
      confidence: "high",
    };
  }

  // Post/Pulse: /posts/...
  const postMatch = parsed.pathname.match(/\/posts\/([a-zA-Z0-9_.-]+)/i);
  if (postMatch) {
    return {
      ok: true,
      canonical: `https://www.linkedin.com/posts/${postMatch[1]}`,
      kind: "url",
      id: postMatch[1],
      confidence: "high",
    };
  }

  return {
    ok: true,
    canonical: parsed.toString(),
    kind: "url",
    confidence: "low",
  };
}

/**
 * 8. Generic Platform Fallback
 * Enforce https, strip tracking parameters, remove fragments, pass-through cleanly.
 */
function normalizeGenericFallback(input: string, platform: string, targetType: string): NormalizeTargetResult {
  const trimmed = input.trim();

  // If plain username without protocol/slashes
  if (targetType === "username" && !trimmed.includes("/")) {
    return normalizeUsername(trimmed, platform);
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    // Enforce https
    parsed.protocol = "https:";
    stripTrackingParams(parsed);
    parsed.hash = "";
    return {
      ok: true,
      canonical: parsed.toString(),
      kind: targetType === "username" ? "username" : "url",
      confidence: "high",
    };
  } catch {
    return {
      ok: true,
      canonical: trimmed,
      kind: targetType === "username" ? "username" : "url",
      confidence: "low",
    };
  }
}

// ==========================================
// UNIFIED PLATFORM REGISTRY
// ==========================================

type PlatformNormalizer = (
  input: string,
  targetType: string,
  resolveShortLinks: boolean,
  resolvers?: TargetResolvers
) => Promise<NormalizeTargetResult> | NormalizeTargetResult;

const PLATFORM_REGISTRY: Record<string, PlatformNormalizer> = {
  instagram: (input, targetType) => normalizeInstagram(input, targetType),
  tiktok: (input, targetType, resolveShortLinks, resolvers) => normalizeTikTok(input, targetType, resolveShortLinks, resolvers),
  youtube: (input, targetType) => normalizeYouTube(input, targetType),
  facebook: (input, targetType, resolveShortLinks, resolvers) => normalizeFacebook(input, targetType, resolveShortLinks, resolvers),
  "x-twitter": (input, targetType) => normalizeXTwitter(input, targetType),
  twitter: (input, targetType) => normalizeXTwitter(input, targetType),
  telegram: (input, targetType) => normalizeTelegram(input, targetType),
  linkedin: (input, targetType) => normalizeLinkedIn(input, targetType),
};

/**
 * Main Pure Function: normalizeTarget
 * Single source of truth for all platforms.
 */
export async function normalizeTarget(
  options: NormalizeTargetOptions,
  resolvers?: TargetResolvers
): Promise<NormalizeTargetResult> {
  const { platform, targetType, input, resolveShortLinks = true } = options;
  const trimmed = (input ?? "").trim();

  if (!trimmed) {
    return { ok: false, code: "INVALID_INPUT", message: "Target cannot be empty." };
  }

  // Security check: reject overly long inputs (max 2048 chars)
  if (trimmed.length > 2048) {
    return { ok: false, code: "INVALID_INPUT", message: "Target input exceeds maximum allowed length (2048 characters)." };
  }

  // Security check: reject non-http(s) schemes like javascript:, data:, file:
  if (/^(javascript|data|vbscript|file|about):/i.test(trimmed)) {
    return { ok: false, code: "INVALID_URL", message: "Invalid URL scheme provided." };
  }

  // Security check: reject control characters
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    return { ok: false, code: "INVALID_INPUT", message: "Target input contains invalid control characters." };
  }

  const normPlatform = (platform ?? "").toLowerCase().trim();

  // 1. Check for cross-platform link mismatch upfront
  const mismatch = checkPlatformMismatch(trimmed, normPlatform);
  if (mismatch.mismatch) {
    const expectedName = PLATFORM_DISPLAY_NAMES[normPlatform] ?? normPlatform;
    return {
      ok: false,
      code: "WRONG_PLATFORM",
      message: `This looks like a ${mismatch.detectedPlatform} link, but you selected ${expectedName}.`,
    };
  }

  // 2. Handle username-type targets directly when no slashes/URLs present
  if (targetType === "username" && !trimmed.includes("/") && !trimmed.includes(".com")) {
    return normalizeUsername(trimmed, normPlatform);
  }

  // 3. Dispatch to registry normalizer
  const normalizer = PLATFORM_REGISTRY[normPlatform];
  if (normalizer) {
    return await normalizer(trimmed, targetType, resolveShortLinks, resolvers);
  }

  // 4. Fallback for any other platforms
  return normalizeGenericFallback(trimmed, normPlatform, targetType);
}
