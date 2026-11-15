import dns from "node:dns/promises";
import net from "node:net";
import { PLATFORM_DOMAINS } from "./normalize.ts";

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
export async function validateSafeHostname(hostname: string): Promise<boolean> {
  const normHost = hostname.toLowerCase().trim();
  if (
    normHost === "localhost" ||
    normHost.endsWith(".localhost") ||
    normHost.endsWith(".local") ||
    normHost.endsWith(".internal")
  ) {
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
 * Generic safe short link redirect resolver with:
 * - Allowed host validation
 * - 3000ms strict timeout
 * - Max 3 hops
 * - SSRF protection (DNS check at each hop)
 * - Stripped cookies/headers
 */
export async function resolveSafeRedirect(
  initialUrl: string,
  allowedDomains: string[],
  platformName: string,
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
    const isAllowedHost = allowedDomains.some((d) => host === d || host.endsWith(`.${d}`));

    if (!isAllowedHost) {
      return {
        ok: false,
        code: "SSRF_BLOCKED",
        message: `Redirect destination host (${host}) is outside the allowed ${platformName} domains.`,
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

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return { ok: false, code: "RESOLUTION_FAILED", message: `${platformName} link redirected without location header.` };
        }
        currentUrl = new URL(location, currentUrl).toString();
      } else {
        return { ok: true, url: currentUrl };
      }
    } catch (err: unknown) {
      const error = err as Error;
      if (error?.name === "AbortError") {
        return { ok: false, code: "RESOLUTION_FAILED", message: `${platformName} link resolution timed out (exceeded 3s).` };
      }
      return { ok: false, code: "RESOLUTION_FAILED", message: `Unable to resolve ${platformName} link: ${error?.message || "network error"}` };
    }
  }

  return { ok: true, url: currentUrl };
}

/**
 * TikTok short link resolver.
 */
export async function resolveTikTokShortLink(
  initialUrl: string,
  fetchFn: typeof fetch = fetch
) {
  return resolveSafeRedirect(initialUrl, PLATFORM_DOMAINS.tiktok, "TikTok", fetchFn);
}

/**
 * Facebook share link resolver.
 */
export async function resolveFacebookShareLink(
  initialUrl: string,
  fetchFn: typeof fetch = fetch
) {
  return resolveSafeRedirect(initialUrl, PLATFORM_DOMAINS.facebook, "Facebook", fetchFn);
}
