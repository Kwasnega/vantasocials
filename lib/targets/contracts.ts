export type TargetContract = "INSTAGRAM_PROFILE" | "INSTAGRAM_CONTENT" | "TIKTOK_PROFILE" | "TIKTOK_VIDEO" | "YOUTUBE_CHANNEL" | "YOUTUBE_VIDEO" | "FACEBOOK_PAGE" | "FACEBOOK_POST" | "FACEBOOK_VIDEO";
export type ContractResult = { valid: true; target: string } | { valid: false; reason: string };

export const targetContracts: Record<string, TargetContract> = {
  "instagram-followers": "INSTAGRAM_PROFILE", "instagram-likes": "INSTAGRAM_CONTENT", "instagram-views": "INSTAGRAM_CONTENT", "instagram-saves": "INSTAGRAM_CONTENT",
  "tiktok-followers": "TIKTOK_PROFILE", "tiktok-views": "TIKTOK_VIDEO", "tiktok-shares": "TIKTOK_VIDEO",
  "youtube-subscribers": "YOUTUBE_CHANNEL", "youtube-likes": "YOUTUBE_VIDEO",
  "facebook-page-followers": "FACEBOOK_PAGE", "facebook-post-likes": "FACEBOOK_POST", "facebook-video-views": "FACEBOOK_VIDEO",
};

export const getTargetContract = (slug: string) => targetContracts[slug] ?? null;
export function getTargetContractForService(input: { slug: string; platformSlug?: string | null; targetType?: string | null }): TargetContract | null {
  const legacy = getTargetContract(input.slug); if (legacy) return legacy;
  const platform = String(input.platformSlug ?? "").toLowerCase(); const target = String(input.targetType ?? "");
  if (platform === "instagram" && target === "url") return "INSTAGRAM_CONTENT";
  if (platform === "tiktok" && target === "username") return "TIKTOK_PROFILE";
  if (platform === "tiktok" && target === "video_url") return "TIKTOK_VIDEO";
  if (platform === "youtube" && target === "channel") return "YOUTUBE_CHANNEL";
  if (platform === "youtube" && target === "video_url") return "YOUTUBE_VIDEO";
  if (platform === "facebook" && target === "page") return "FACEBOOK_PAGE";
  if (platform === "facebook" && target === "post_url") return "FACEBOOK_POST";
  if (platform === "facebook" && target === "video_url") return "FACEBOOK_VIDEO";
  return null;
}
const fail = (reason: string): ContractResult => ({ valid: false, reason });
function url(value: string) { try { const parsed = new URL(value.trim()); if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null; parsed.hostname = parsed.hostname.toLowerCase(); parsed.hash = ""; if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/$/, ""); return parsed; } catch { return null; } }
function host(parsed: URL, domains: string[]) { return domains.includes(parsed.hostname); }
function profile(value: string, domains: string[], canonical: string, pattern: RegExp): ContractResult { const raw = value.trim(); if (!raw) return fail("Target is required."); if (!/^https?:\/\//i.test(raw)) { const username = raw.replace(/^@/, ""); if (!/^[A-Za-z0-9._-]{1,64}$/.test(username)) return fail("Invalid profile username."); return { valid: true, target: `${canonical}/${username}` }; } const parsed = url(raw); if (!parsed || parsed.protocol !== "https:" || !host(parsed, domains) || !pattern.test(parsed.pathname)) return fail("Target must be a valid profile URL."); return { valid: true, target: parsed.toString() }; }
function content(value: string, domains: string[], pattern: RegExp, queryRequired = false): ContractResult { const parsed = url(value); if (!parsed || parsed.protocol !== "https:" || !host(parsed, domains) || !pattern.test(parsed.pathname) || (queryRequired && !parsed.searchParams.get("v"))) return fail("Target must be a valid content URL."); return { valid: true, target: parsed.toString() }; }

export function normalizeTarget(slug: string, value: string): ContractResult {
  const contract = getTargetContract(slug); if (!contract) return fail("No target contract is defined for this service.");
  switch (contract) {
    case "INSTAGRAM_PROFILE": return profile(value, ["instagram.com", "www.instagram.com"], "https://www.instagram.com", /^\/[^/]+$/);
    case "TIKTOK_PROFILE": { const raw = value.trim(); if (!/^https?:\/\//i.test(raw)) { const username = raw.replace(/^@/, ""); return /^[A-Za-z0-9._-]{1,64}$/.test(username) ? { valid: true, target: `https://www.tiktok.com/@${username}` } : fail("Invalid TikTok profile username."); } return profile(raw, ["tiktok.com", "www.tiktok.com"], "https://www.tiktok.com/@", /^\/@[^/]+$/); }
    case "YOUTUBE_CHANNEL": { const parsed = url(value); if (!parsed || !host(parsed, ["youtube.com", "www.youtube.com"]) || !/^\/(?:channel\/|c\/|@)[^/]+$/.test(parsed.pathname)) return fail("Target must be a valid YouTube channel URL."); return { valid: true, target: parsed.toString() }; }
    case "FACEBOOK_PAGE": { const parsed = url(value); if (!parsed || !host(parsed, ["facebook.com", "www.facebook.com", "m.facebook.com"]) || !/^\/[^/]+$/.test(parsed.pathname)) return fail("Target must be a valid Facebook page URL."); return { valid: true, target: parsed.toString() }; }
    case "INSTAGRAM_CONTENT": return content(value, ["instagram.com", "www.instagram.com"], /^\/(?:p|reel)\/[^/]+$/);
    case "TIKTOK_VIDEO": return content(value, ["tiktok.com", "www.tiktok.com"], /^\/@[^/]+\/video\/[^/]+$/);
    case "YOUTUBE_VIDEO": { const parsed = url(value); if (!parsed || parsed.protocol !== "https:" || !host(parsed, ["youtube.com", "www.youtube.com", "youtu.be"])) return fail("Target must be a valid YouTube video URL."); const valid = parsed.hostname === "youtu.be" ? /^\/[^/]+$/.test(parsed.pathname) : ((parsed.pathname === "/watch" && Boolean(parsed.searchParams.get("v"))) || /^\/shorts\/[^/]+$/.test(parsed.pathname)); if (!valid) return fail("Target must be a valid YouTube video URL."); if (parsed.hostname !== "youtube.com" && parsed.hostname !== "www.youtube.com") { parsed.search = ""; return { valid: true, target: parsed.toString() }; } const videoId = parsed.pathname === "/watch" ? parsed.searchParams.get("v") : parsed.pathname.split("/").pop(); parsed.search = ""; if (parsed.pathname === "/watch") parsed.searchParams.set("v", videoId!); return { valid: true, target: parsed.toString() }; }
    case "FACEBOOK_POST": return content(value, ["facebook.com", "www.facebook.com", "m.facebook.com"], /\/posts\/[^/]+$|\/permalink\.php$/);
    case "FACEBOOK_VIDEO": return content(value, ["facebook.com", "www.facebook.com", "m.facebook.com"], /\/(?:videos|reel|reels)\/[^/]+$/);
  }
}

export function effectiveQuantityBounds(vantaMin: number, vantaMax: number, providerMin: number, providerMax: number) { return { min: Math.max(vantaMin, providerMin), max: Math.min(vantaMax, providerMax) }; }
