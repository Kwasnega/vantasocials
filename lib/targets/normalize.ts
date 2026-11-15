import dns from "node:dns/promises";
import net from "node:net";

export type NormalizeTargetOptions = {
  platform: string;
  targetType: string;
  input: string;
  resolveShortLinks?: boolean; // Default true in server environment
};

export type NormalizeTargetResult =
  | {
      ok: true;
      canonical: string;
      kind: "url" | "username";
      id?: string;
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

// Known domains per platform for cross-platform checking
const PLATFORM_DOMAINS: Record<string, string[]> = {
  instagram: ["instagram.com", "instagr.am"],
  tiktok: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"],
  youtube: ["youtube.com", "youtu.be"],
  facebook: ["facebook.com", "fb.watch", "fb.com"],
  "x-twitter": ["x.com", "twitter.com"],
  twitter: ["x.com", "twitter.com"],
  linkedin: ["linkedin.com"],
  telegram: ["t.me", "telegram.me"],
  pinterest: ["pinterest.com"],
  spotify: ["spotify.com"],
};

/**
 * Checks if an IP is private, internal, link-local, loopback, or multicast.
 */
export function isPrivateOrInternalIp(ip: string): boolean {
  if (!net.isIP(ip)) return true;

  // IPv4 checks
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const [b0, b1] = parts;

    // 0.0.0.0/8 (current network)
    if (b0 === 0) return true;
    // 10.0.0.0/8 (private)
    if (b0 === 10) return true;
    // 127.0.0.0/8 (loopback)
    if (b0 === 127) return true;
    // 169.254.0.0/16 (link-local)
    if (b0 === 169 && b1 === 254) return true;
    // 172.16.0.0/12 (private: 172.16.0.0 - 172.31.255.255)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    // 192.168.0.0/16 (private)
    if (b0 === 192 && b1 === 168) return true;
    // 224.0.0.0/4 (multicast) & 240.0.0.0/4 (reserved)
    if (b0 >= 224) return true;

    return false;
  }

  // IPv6 checks
  if (net.isIPv6(ip)) {
    const norm = ip.toLowerCase();
    // Loopback ::1
    if (norm === "::1" || norm === "0000:0000:0000:0000:0000:0000:0000:0001") return true;
    // Unspecified ::
    if (norm === "::" || norm === "0000:0000:0000:0000:0000:0000:0000:0000") return true;
    // Unique local (fc00::/7)
    if (norm.startsWith("fc") || norm.startsWith("fd")) return true;
    // Link-local (fe80::/10)
    if (norm.startsWith("fe8") || norm.startsWith("fe9") || norm.startsWith("fea") || norm.startsWith("feb")) return true;
    // IPv4-mapped IPv6 (::ffff:x.x.x.x)
    if (norm.includes("::ffff:")) {
      const ipv4Part = norm.split("::ffff:")[1];
      if (ipv4Part && net.isIPv4(ipv4Part)) {
        return isPrivateOrInternalIp(ipv4Part);
      }
    }
  }

  return false;
}

/**
 * Validates that a hostname resolves only to safe public IPs.
 */
async function validateSafeHostname(hostname: string): Promise<boolean> {
  const normHost = hostname.toLowerCase().trim();
  if (normHost === "localhost" || normHost.endsWith(".localhost") || normHost.endsWith(".local") || normHost.endsWith(".internal")) {
    return false;
  }

  if (net.isIP(normHost)) {
    return !isPrivateOrInternalIp(normHost);
  }

  try {
    const addresses = await dns.lookup(normHost, { all: true });
    if (!addresses || addresses.length === 0) return false;
    for (const record of addresses) {
      if (isPrivateOrInternalIp(record.address)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves short links (e.g. vm.tiktok.com, vt.tiktok.com, tiktok.com/t/) to destination video URLs.
 * Enforces:
 * - Host allowlist: only tiktok.com and its approved subdomains
 * - Strict timeout: 3000ms
 * - Max hops: 3
 * - SSRF protection: DNS resolution check at every hop
 */
export async function resolveTikTokShortLink(
  initialUrl: string,
  fetchFn: typeof fetch = fetch
): Promise<{ ok: true; url: string } | { ok: false; code: "RESOLUTION_FAILED" | "SSRF_BLOCKED"; message: string }> {
  let currentUrl = initialUrl;
  const maxHops = 3;

  for (let hop = 0; hop < maxHops; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return { ok: false, code: "RESOLUTION_FAILED", message: "Failed to parse redirect URL." };
    }

    const host = parsed.hostname.toLowerCase();
    const isAllowedHost =
      host === "tiktok.com" ||
      host.endsWith(".tiktok.com") ||
      host === "vm.tiktok.com" ||
      host === "vt.tiktok.com";

    if (!isAllowedHost) {
      return {
        ok: false,
        code: "SSRF_BLOCKED",
        message: "Redirect destination host is outside the allowed TikTok domains.",
      };
    }

    // SSRF Check: resolve host and check for private/internal IPs
    const isSafe = await validateSafeHostname(host);
    if (!isSafe) {
      return {
        ok: false,
        code: "SSRF_BLOCKED",
        message: "Redirect blocked by security filter: destination resolves to an internal or private address.",
      };
    }

    // If current URL already contains a video ID, we are done
    if (/@[\w.-]+\/video\/\d+/.test(parsed.pathname) || /\/v\/\d+/.test(parsed.pathname)) {
      return { ok: true, url: currentUrl };
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);

      const response = await fetchFn(currentUrl, {
        method: "HEAD",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      clearTimeout(timer);

      // Check for redirect location
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return { ok: false, code: "RESOLUTION_FAILED", message: "TikTok short link redirected without location header." };
        }
        currentUrl = new URL(location, currentUrl).toString();
      } else if (response.ok) {
        // Did not redirect, or HEAD succeeded on final URL
        return { ok: true, url: currentUrl };
      } else {
        // Fallback: try GET with stream abort to catch meta/redirect if HEAD returned 405
        return { ok: true, url: currentUrl };
      }
    } catch (err: unknown) {
      const error = err as Error;
      if (error?.name === "AbortError") {
        return { ok: false, code: "RESOLUTION_FAILED", message: "TikTok link resolution timed out (exceeded 3s)." };
      }
      return { ok: false, code: "RESOLUTION_FAILED", message: `Unable to resolve TikTok short link: ${error?.message || "network error"}` };
    }
  }

  return { ok: true, url: currentUrl };
}

/**
 * Checks if a given input appears to be a link belonging to a different platform.
 */
function checkPlatformMismatch(input: string, expectedPlatform: string): { mismatch: boolean; detectedPlatform?: string } {
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
      if (platform !== normExpected && !(normExpected === "x-twitter" && platform === "twitter") && !(normExpected === "twitter" && platform === "x-twitter")) {
        return { mismatch: true, detectedPlatform: platform };
      }
      return { mismatch: false };
    }
  }

  return { mismatch: false };
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
    // If it's a URL, check if we can cleanly extract username or guide user
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
    // IG handles: lowercase, 1-30 chars, alphanumeric, dots, underscores, no consecutive dots
    handle = handle.toLowerCase();
    if (handle.length < 1 || handle.length > 30) {
      return {
        ok: false,
        code: "INVALID_USERNAME",
        message: "Instagram username must be between 1 and 30 characters.",
      };
    }
    if (!/^[a-z0-9._]+$/.test(handle)) {
      return {
        ok: false,
        code: "INVALID_USERNAME",
        message: "Instagram username can only contain letters, numbers, periods, and underscores.",
      };
    }
    if (handle.startsWith(".") || handle.endsWith(".")) {
      return {
        ok: false,
        code: "INVALID_USERNAME",
        message: "Instagram username cannot start or end with a period.",
      };
    }
    return {
      ok: true,
      canonical: handle,
      kind: "username",
      id: handle,
    };
  }

  if (platform === "tiktok") {
    // TikTok handles: 2-24 chars, letters, numbers, underscores, periods (not ending with period)
    if (handle.length < 2 || handle.length > 24) {
      return {
        ok: false,
        code: "INVALID_USERNAME",
        message: "TikTok username must be between 2 and 24 characters.",
      };
    }
    if (!/^[a-zA-Z0-9_.]+$/.test(handle)) {
      return {
        ok: false,
        code: "INVALID_USERNAME",
        message: "TikTok username can only contain letters, numbers, underscores, and periods.",
      };
    }
    if (handle.endsWith(".")) {
      return {
        ok: false,
        code: "INVALID_USERNAME",
        message: "TikTok username cannot end with a period.",
      };
    }
    return {
      ok: true,
      canonical: handle,
      kind: "username",
      id: handle,
    };
  }

  return {
    ok: true,
    canonical: handle,
    kind: "username",
    id: handle,
  };
}

/**
 * Normalizes Instagram URLs.
 * Accepts: instagram.com/p/{shortcode}, /reel/{shortcode}, /tv/{shortcode}, with/without www,
 * mobile variants, with user in path (instagram.com/{user}/p/{shortcode}).
 * Output: https://www.instagram.com/p/{shortcode}/ or /reel/{shortcode}/ or /tv/{shortcode}/
 * Strips all query parameters (?igsh, ?utm_*, ?img_index, etc.) and fragments.
 */
function normalizeInstagramUrl(input: string, targetType: string): NormalizeTargetResult {
  const trimmed = input.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return {
      ok: false,
      code: "INVALID_URL",
      message: "Please enter a valid Instagram URL (e.g. https://www.instagram.com/p/SHORTCODE/).",
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const isIgDomain =
    hostname === "instagram.com" ||
    hostname === "www.instagram.com" ||
    hostname === "instagr.am" ||
    hostname === "m.instagram.com";

  if (!isIgDomain) {
    const mismatch = checkPlatformMismatch(input, "instagram");
    if (mismatch.mismatch) {
      return {
        ok: false,
        code: "WRONG_PLATFORM",
        message: `This link is from ${mismatch.detectedPlatform ?? "another platform"}, but this service requires an Instagram link.`,
      };
    }
    return {
      ok: false,
      code: "INVALID_URL",
      message: "Please enter a valid Instagram URL (e.g. https://www.instagram.com/p/SHORTCODE/).",
    };
  }

  // Parse path
  // Could be /p/{shortcode}/, /reel/{shortcode}/, /tv/{shortcode}/, /reels/{shortcode}/, or /{user}/p/{shortcode}/
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return {
      ok: false,
      code: "INVALID_URL",
      message: "The Instagram link is missing the post or profile path.",
    };
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
    // Validate shortcode characters (alphanumeric, underscores, hyphens)
    if (!/^[a-zA-Z0-9_-]+$/.test(shortcode)) {
      return {
        ok: false,
        code: "INVALID_URL",
        message: "The Instagram post shortcode contains invalid characters.",
      };
    }

    const canonical = `https://www.instagram.com/${type}/${shortcode}/`;
    return {
      ok: true,
      canonical,
      kind: "url",
      id: shortcode,
    };
  }

  // If this is a profile link (/username) for a profile target
  if (targetType === "username" || targetType === "channel" || targetType === "page") {
    const username = segments[0];
    if (username && !["explore", "stories", "accounts"].includes(username.toLowerCase())) {
      const userRes = normalizeUsername(username, "instagram");
      if (userRes.ok) {
        return {
          ok: true,
          canonical: userRes.canonical,
          kind: "username",
          id: userRes.id,
        };
      }
      return userRes;
    }
  }

  return {
    ok: false,
    code: "INVALID_URL",
    message: "Could not find a valid Instagram post, reel, or video shortcode in the link.",
  };
}

/**
 * Normalizes TikTok URLs.
 * Accepts: tiktok.com/@{user}/video/{id}, short links (vm.tiktok.com, vt.tiktok.com, tiktok.com/t/...)
 * Strips all query parameters (?_r, ?_t, ?is_from_webapp, etc.) and fragments.
 * Output: https://www.tiktok.com/@{user}/video/{id}
 */
async function normalizeTikTokUrl(
  input: string,
  targetType: string,
  resolveShortLinks: boolean = true
): Promise<NormalizeTargetResult> {
  const trimmed = input.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return {
      ok: false,
      code: "INVALID_URL",
      message: "Please enter a valid TikTok URL (e.g. https://www.tiktok.com/@creator/video/1234567890123456789).",
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const isTikTokDomain =
    hostname === "tiktok.com" ||
    hostname.endsWith(".tiktok.com") ||
    hostname === "vm.tiktok.com" ||
    hostname === "vt.tiktok.com";

  if (!isTikTokDomain) {
    const mismatch = checkPlatformMismatch(input, "tiktok");
    if (mismatch.mismatch) {
      return {
        ok: false,
        code: "WRONG_PLATFORM",
        message: `This link is from ${mismatch.detectedPlatform ?? "another platform"}, but this service requires a TikTok link.`,
      };
    }
    return {
      ok: false,
      code: "INVALID_URL",
      message: "Please enter a valid TikTok URL (e.g. https://www.tiktok.com/@creator/video/1234567890123456789).",
    };
  }

  // Check if it's a short link: vm.tiktok.com/..., vt.tiktok.com/..., tiktok.com/t/...
  const isShortLink =
    hostname === "vm.tiktok.com" ||
    hostname === "vt.tiktok.com" ||
    (hostname.endsWith("tiktok.com") && parsed.pathname.startsWith("/t/"));

  let targetUrl = withProtocol;

  if (isShortLink) {
    if (!resolveShortLinks) {
      // In client-only environments if short-link resolution is disabled, return clean short URL
      parsed.search = "";
      parsed.hash = "";
      return {
        ok: true,
        canonical: parsed.toString(),
        kind: "url",
      };
    }

    const resolved = await resolveTikTokShortLink(withProtocol);
    if (!resolved.ok) {
      return resolved;
    }
    targetUrl = resolved.url;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return {
        ok: false,
        code: "RESOLUTION_FAILED",
        message: "Failed to parse resolved TikTok URL.",
      };
    }
  }

  // Parse path: /@{user}/video/{id} or /v/{id}
  const path = parsed.pathname;
  const videoMatch = path.match(/\/@([a-zA-Z0-9_.-]+)\/video\/(\d+)/i) || path.match(/\/v\/(\d+)/i);

  if (videoMatch) {
    if (videoMatch.length === 3) {
      const user = videoMatch[1];
      const videoId = videoMatch[2];
      const canonical = `https://www.tiktok.com/@${user}/video/${videoId}`;
      return {
        ok: true,
        canonical,
        kind: "url",
        id: videoId,
      };
    } else if (videoMatch.length === 2) {
      const videoId = videoMatch[1];
      const canonical = `https://www.tiktok.com/video/${videoId}`;
      return {
        ok: true,
        canonical,
        kind: "url",
        id: videoId,
      };
    }
  }

  // If this is a profile link (/ @username)
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
      };
    }
    return userRes;
  }

  return {
    ok: false,
    code: "INVALID_URL",
    message: "Could not find a valid TikTok video or profile in the link. Use https://www.tiktok.com/@creator/video/ID",
  };
}

/**
 * Main Pure Function: normalizeTarget
 * Canonicalizes targets for Instagram, TikTok, and general usernames.
 * Pass-through for other platforms.
 */
export async function normalizeTarget(options: NormalizeTargetOptions): Promise<NormalizeTargetResult> {
  const { platform, targetType, input, resolveShortLinks = true } = options;
  const trimmed = (input ?? "").trim();

  if (!trimmed) {
    return { ok: false, code: "INVALID_INPUT", message: "Target cannot be empty." };
  }

  const normPlatform = (platform ?? "").toLowerCase().trim();

  // 1. Check for cross-platform link mismatch upfront
  const mismatch = checkPlatformMismatch(trimmed, normPlatform);
  if (mismatch.mismatch) {
    return {
      ok: false,
      code: "WRONG_PLATFORM",
      message: `This link is from ${mismatch.detectedPlatform ?? "another platform"}, but this service requires a ${normPlatform} link.`,
    };
  }

  // 2. Handle username-type services for Instagram and TikTok (or explicit username charset validation)
  if (targetType === "username") {
    if (normPlatform === "instagram") {
      return normalizeUsername(trimmed, "instagram");
    }
    if (normPlatform === "tiktok") {
      return normalizeUsername(trimmed, "tiktok");
    }
    // For other platforms, if not Instagram/TikTok, pass through cleanly
    return {
      ok: true,
      canonical: trimmed,
      kind: "username",
      id: trimmed,
    };
  }

  // 3. Platform-specific link canonicalization
  if (normPlatform === "instagram") {
    return normalizeInstagramUrl(trimmed, targetType);
  }

  if (normPlatform === "tiktok") {
    return normalizeTikTokUrl(trimmed, targetType, resolveShortLinks);
  }

  // 4. Other platforms: pass through unchanged with trimmed whitespace
  return {
    ok: true,
    canonical: trimmed,
    kind: targetType === "username" ? "username" : "url",
  };
}
