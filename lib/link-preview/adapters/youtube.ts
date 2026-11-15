import type { LinkPreviewAdapter, LinkPreviewResult } from "../types";
import { sanitizePreviewText } from "../sanitize.ts";

const MAX_RESPONSE_BYTES = 50 * 1024; // 50 KB defensive limit
const TIMEOUT_MS = 4000; // 4 seconds strict timeout

export const youtubeAdapter: LinkPreviewAdapter = {
  platform: "youtube",
  async getPreview(canonicalUrl: string): Promise<LinkPreviewResult> {
    try {
      const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "User-Agent": "VantaBot/1.0",
          },
          signal: controller.signal,
          redirect: "error", // Never follow redirects
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          return { ok: false, code: "TIMEOUT", message: "YouTube request timed out." };
        }
        return { ok: false, code: "UNAVAILABLE", message: "Failed to connect to YouTube." };
      } finally {
        clearTimeout(timer);
      }

      if (res.status === 404) {
        return { ok: false, code: "NOT_FOUND", message: "Video not found or is private." };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, code: "PRIVATE_OR_REMOVED", message: "Video is private or restricted." };
      }
      if (res.status === 429) {
        return { ok: false, code: "RATE_LIMITED", message: "YouTube rate limit exceeded." };
      }
      if (!res.ok) {
        return { ok: false, code: "UNAVAILABLE", message: `YouTube returned status ${res.status}.` };
      }

      // Check content-length header defensively
      const contentLength = res.headers.get("content-length");
      if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
        return { ok: false, code: "UNAVAILABLE", message: "Response too large." };
      }

      const text = await res.text();
      if (text.length > MAX_RESPONSE_BYTES) {
        return { ok: false, code: "UNAVAILABLE", message: "Response body exceeded limit." };
      }

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(text);
      } catch {
        return { ok: false, code: "UNAVAILABLE", message: "Invalid JSON from YouTube." };
      }

      const title = sanitizePreviewText(data.title);
      const authorName = sanitizePreviewText(data.author_name);
      const authorUrl = typeof data.author_url === "string" ? data.author_url : undefined;
      const thumbnailUrl = typeof data.thumbnail_url === "string" ? data.thumbnail_url : undefined;

      return {
        ok: true,
        data: {
          title: title || "YouTube Video",
          authorName: authorName || "YouTube Creator",
          authorUrl,
          thumbnailUrl,
          providerName: "YouTube",
          fetchedAt: new Date().toISOString(),
        },
      };
    } catch {
      return { ok: false, code: "UNAVAILABLE", message: "Unexpected YouTube preview error." };
    }
  },
};
