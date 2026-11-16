/**
 * Strict canonical origin utility for VANTA.
 *
 * Security requirements:
 * 1. Default to hardcoded canonical: https://www.vantasocials.shop
 * 2. Never trust Host or X-Forwarded-Host headers.
 * 3. Never accept *.vercel.app origins or substring matches (e.g. vantasocials.shop.evil.com).
 * 4. Only accept an env override if its hostname EXACTLY equals www.vantasocials.shop,
 *    or localhost / 127.0.0.1 in non-production.
 */

const CANONICAL_PRODUCTION_ORIGIN = "https://www.vantasocials.shop";

export function getCanonicalSiteOrigin(): string {
  const isProd = process.env.NODE_ENV === "production";
  const envVal = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "").trim();

  if (envVal) {
    try {
      const parsed = new URL(envVal);
      const host = parsed.hostname.toLowerCase();

      // In production, only accept exact www.vantasocials.shop
      if (isProd) {
        if (host === "www.vantasocials.shop" && parsed.protocol === "https:") {
          return `${parsed.protocol}//${parsed.host}`;
        }
      } else {
        // In dev/test, allow localhost, 127.0.0.1, or www.vantasocials.shop
        if (
          host === "localhost" ||
          host === "127.0.0.1" ||
          host === "www.vantasocials.shop"
        ) {
          return `${parsed.protocol}//${parsed.host}`;
        }
      }
    } catch {
      // Invalid URL in env - ignore and fall through
    }
  }

  if (!isProd) {
    return "http://localhost:3000";
  }

  return CANONICAL_PRODUCTION_ORIGIN;
}
