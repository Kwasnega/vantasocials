import type { LinkPreviewAdapter, LinkPreviewResult } from "./types";
import { linkPreviewCache } from "./cache.ts";
import { youtubeAdapter } from "./adapters/youtube.ts";
import { xAdapter } from "./adapters/x.ts";
import { tiktokAdapter } from "./adapters/tiktok.ts";

// Registry of supported platform adapters
const ADAPTERS: Record<string, LinkPreviewAdapter> = {
  youtube: youtubeAdapter,
  x: xAdapter,
  twitter: xAdapter,
  "x-twitter": xAdapter,
  tiktok: tiktokAdapter,
};

/**
 * Normalizes platform slug to find a matching adapter.
 */
function getAdapter(platform: string): LinkPreviewAdapter | null {
  const normalized = platform.toLowerCase().trim();
  return ADAPTERS[normalized] ?? null;
}

/**
 * Fetches preview for a canonical URL.
 * - Checks unsupported platform immediately with NO network call.
 * - Uses in-memory caching and request coalescing.
 */
export async function getLinkPreview(platform: string, canonicalUrl: string): Promise<LinkPreviewResult> {
  const adapter = getAdapter(platform);
  if (!adapter) {
    return { ok: false, code: "UNSUPPORTED" };
  }

  const cacheKey = `${adapter.platform}:${canonicalUrl}`;

  return linkPreviewCache.coalesce(cacheKey, async () => {
    return adapter.getPreview(canonicalUrl);
  });
}
