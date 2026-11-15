import type { LinkPreviewResult } from "./types";

interface CacheEntry {
  result: LinkPreviewResult;
  expiresAt: number;
}

class LinkPreviewCache {
  private cache = new Map<string, CacheEntry>();
  private inFlight = new Map<string, Promise<LinkPreviewResult>>();
  private readonly maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }

  get(key: string): LinkPreviewResult | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.result;
  }

  set(key: string, result: LinkPreviewResult): void {
    let ttlMs = 0;
    if (result.ok) {
      // Cache successful previews for ~1 hour
      ttlMs = 60 * 60 * 1000;
    } else if (result.code === "NOT_FOUND" || result.code === "PRIVATE_OR_REMOVED") {
      // Cache 404 / private for ~2 minutes
      ttlMs = 2 * 60 * 1000;
    } else {
      // NEVER cache TIMEOUT, UNAVAILABLE, or RATE_LIMITED
      return;
    }

    // Evict oldest if reaching capacity
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      result,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Coalesces concurrent identical requests to the same canonical link.
   */
  async coalesce(key: string, fetcher: () => Promise<LinkPreviewResult>): Promise<LinkPreviewResult> {
    const cached = this.get(key);
    if (cached) return cached;

    const existingPromise = this.inFlight.get(key);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = (async () => {
      try {
        const result = await fetcher();
        this.set(key, result);
        return result;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.cache.clear();
    this.inFlight.clear();
  }
}

// Global in-memory cache instance (singleton per server process)
export const linkPreviewCache = new LinkPreviewCache();
