import type { LinkPreviewAdapter, LinkPreviewResult } from "../types";

/**
 * Validates TikTok username according to normalizer rules:
 * - 2 to 24 characters
 * - Only letters, numbers, underscores, and periods
 * - Cannot end with a period
 */
function isValidTikTokUsername(username: string): boolean {
  if (username.length < 2 || username.length > 24) return false;
  if (!/^[a-zA-Z0-9_.]+$/.test(username)) return false;
  if (username.endsWith(".")) return false;
  return true;
}

/**
 * TikTok Adapter (Zero network call, pure canonical URL parser)
 *
 * Takes canonical URL: https://www.tiktok.com/@{user}/video/{id}
 * (or mobile/alternate canonicals conforming to /@{user}/video/{id})
 * Extracts username and video ID, validates charset rules,
 * and returns ok:true with { title: null, authorName: "@{user}", ... }.
 * If it doesn't match or is an unresolved shortlink, returns UNSUPPORTED.
 */
export const tiktokAdapter: LinkPreviewAdapter = {
  platform: "tiktok",
  async getPreview(canonicalUrl: string): Promise<LinkPreviewResult> {
    try {
      const parsed = new URL(canonicalUrl);
      const hostname = parsed.hostname.toLowerCase();

      // Must be tiktok.com domain
      if (hostname !== "tiktok.com" && !hostname.endsWith(".tiktok.com")) {
        return { ok: false, code: "UNSUPPORTED" };
      }

      // Check standard canonical video pattern: /@{user}/video/{id}
      const match = parsed.pathname.match(/^\/@([a-zA-Z0-9_.-]+)\/video\/(\d+)\/?$/i);
      if (!match) {
        return { ok: false, code: "UNSUPPORTED" };
      }

      const rawUser = match[1];
      const videoId = match[2];

      if (!isValidTikTokUsername(rawUser) || !videoId) {
        return { ok: false, code: "UNSUPPORTED" };
      }

      const authorName = `@${rawUser}`;
      const authorUrl = `https://www.tiktok.com/@${rawUser}`;

      return {
        ok: true,
        data: {
          title: null,
          authorName,
          authorUrl,
          thumbnailUrl: null,
          providerName: "TikTok",
          fetchedAt: new Date().toISOString(),
        },
      };
    } catch {
      return { ok: false, code: "UNSUPPORTED" };
    }
  },
};
