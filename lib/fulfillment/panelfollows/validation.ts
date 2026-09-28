import "server-only";

import type { ProviderService } from "./client";
import { validateProviderQuantity } from "./pricing";

export type VantaTargetValidation = { valid: true; target: string } | { valid: false; reason: string };

const VANTA_LIMITS = { min: 100, max: 100000 } as const;

function directUrl(value: string, hosts: readonly string[], path: RegExp): VantaTargetValidation {
  const target = value.trim();
  if (!target || target.length > 2048) return { valid: false, reason: "Target is empty or too long." };
  let url: URL;
  try { url = new URL(target); } catch { return { valid: false, reason: "Target must be a valid URL." }; }
  if (url.protocol !== "https:" || !hosts.includes(url.hostname.toLowerCase())) return { valid: false, reason: "Target must be an HTTPS URL on the expected platform." };
  if (!path.test(url.pathname) || url.search || url.hash) return { valid: false, reason: "Target must be a direct public content URL." };
  return { valid: true, target: url.toString() };
}

export function validatePanelFollowsTarget(vantaSlug: string, value: string): VantaTargetValidation {
  switch (vantaSlug) {
    case "instagram-likes":
      return directUrl(value, ["instagram.com", "www.instagram.com"], /^\/(?:p|reel)\/[A-Za-z0-9_-]+\/?$/);
    case "facebook-post-likes":
      return directUrl(value, ["facebook.com", "www.facebook.com", "m.facebook.com"], /^\/(?:[^/?#]+\/posts\/[^/?#]+|permalink\.php|[^/?#]+\/videos\/[^/?#]+)\/?$/);
    case "x-post-views":
      return directUrl(value, ["x.com", "www.x.com", "twitter.com", "www.twitter.com"], /^\/[A-Za-z0-9_]{1,15}\/status\/\d+\/?$/);
    default:
      return { valid: false, reason: "No approved PanelFollows mapping exists for this service." };
  }
}

export function validatePanelFollowsQuantity(quantity: number, provider: ProviderService) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return { valid: false as const, reason: "Quantity must be a positive integer." };
  if (quantity < VANTA_LIMITS.min || quantity > VANTA_LIMITS.max) return { valid: false as const, reason: "Quantity is outside VANTA limits." };
  const compatibility = validateProviderQuantity(VANTA_LIMITS.min, VANTA_LIMITS.max, provider.minQuantity, provider.maxQuantity);
  if (!compatibility.compatible) return { valid: false as const, reason: compatibility.reason };
  if (quantity < provider.minQuantity || quantity > provider.maxQuantity) return { valid: false as const, reason: "Quantity is outside provider limits." };
  return { valid: true as const };
}

export function assertApprovedPanelFollowsService(provider: ProviderService, vantaSlug: string) {
  const expected: Record<string, { id: string; category: string; platform: string }> = {
    "instagram-likes": { id: "8", category: "instagram-likes", platform: "instagram" },
    "facebook-post-likes": { id: "3354", category: "facebook-likes", platform: "facebook" },
    "x-post-views": { id: "2769", category: "twitter-views", platform: "twitter" },
  };
  const match = expected[vantaSlug];
  if (!match || provider.providerServiceId !== match.id || provider.category !== match.category || provider.rawMetadata.platform !== match.platform || !provider.rawMetadata.is_active) {
    throw new Error("PanelFollows service does not match the approved server-side mapping.");
  }
}
