import type { LinkPreviewAdapter, LinkPreviewResult } from "../types";
import { sanitizePreviewText } from "../sanitize.ts";

const MAX_RESPONSE_BYTES = 50 * 1024; // 50 KB defensive limit
const TIMEOUT_MS = 4000; // 4 seconds strict timeout

export const xAdapter: LinkPreviewAdapter = {
  platform: "x",
  async getPreview(canonicalUrl: string): Promise<LinkPreviewResult> {
    try {
      const endpoint = `https://publish.x.com/oembed?url=${encodeURIComponent(canonicalUrl)}`;

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
          return { ok: false, code: "TIMEOUT", message: "X request timed out." };
        }
        return { ok: false, code: "UNAVAILABLE", message: "Failed to connect to X." };
      } finally {
        clearTimeout(timer);
      }

      if (res.status === 404) {
        return { ok: false, code: "NOT_FOUND", message: "Post not found or account is suspended." };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, code: "PRIVATE_OR_REMOVED", message: "Post is from a private or protected account." };
      }
      if (res.status === 429) {
        return { ok: false, code: "RATE_LIMITED", message: "X rate limit reached." };
      }
      if (!res.ok) {
        return { ok: false, code: "UNAVAILABLE", message: `X returned status ${res.status}.` };
      }

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
        return { ok: false, code: "UNAVAILABLE", message: "Invalid JSON from X." };
      }

      const authorName = sanitizePreviewText(data.author_name);
      const authorUrl = typeof data.author_url === "string" ? data.author_url : undefined;

      // Extract text content from the <p> block in html if present
      let postSnippet = "";
      if (typeof data.html === "string") {
        const pMatch = data.html.match(/<p[^>]*>(.*?)<\/p>/s);
        if (pMatch && pMatch[1]) {
          postSnippet = sanitizePreviewText(pMatch[1]);
        }
      }

      return {
        ok: true,
        data: {
          title: postSnippet || `Post by @${authorName}`,
          authorName: authorName ? `@${authorName}` : "X User",
          authorUrl,
          providerName: "X",
          fetchedAt: new Date().toISOString(),
        },
      };
    } catch {
      return { ok: false, code: "UNAVAILABLE", message: "Unexpected X preview error." };
    }
  },
};
