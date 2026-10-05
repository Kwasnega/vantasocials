export type VantaTargetValidation = { valid: true; target: string } | { valid: false; reason: string };

export type VantaTargetType = "username" | "url" | "post_url" | "video_url" | "channel" | "page";

export type ReliableSMMTarget = { link: string };
import { getTargetContract, normalizeTarget } from "../../targets/contracts";

const MAX_TARGET_LENGTH = 2048;

function rejected(reason: string): VantaTargetValidation { return { valid: false, reason }; }

function instagramViewTarget(value: string): VantaTargetValidation {
  const target = value.trim();
  if (!target || target.length > MAX_TARGET_LENGTH) return rejected("Target is empty or too long.");
  if (/[\u0000-\u001f\u007f]/.test(target)) return rejected("Target contains invalid control characters.");
  let url: URL;
  try { url = new URL(target); } catch { return rejected("Target must be a valid URL."); }
  if (url.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(url.hostname.toLowerCase())) return rejected("Target must be an HTTPS URL on the expected platform.");
  if (!/^\/(?:p|reel)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) || url.search || url.hash) return rejected("Target must be a direct public content URL.");
  return { valid: true, target: url.toString() };
}

function httpsUrl(value: string): VantaTargetValidation {
  const target = value.trim();
  if (!target || target.length > MAX_TARGET_LENGTH) return rejected("Target is empty or too long.");
  if (/[\u0000-\u001f\u007f]/.test(target)) return rejected("Target contains invalid control characters.");
  let url: URL;
  try { url = new URL(target); } catch { return rejected("Target must be a valid URL."); }
  if (url.protocol !== "https:") return rejected("Target must be an HTTPS URL.");
  if (url.username || url.password) return rejected("Target must not contain URL credentials.");
  return { valid: true, target: url.toString() };
}

/**
 * ReliableSMM exposes only one target field (`link`). We therefore pass through
 * only absolute HTTPS targets. Opaque usernames, page names, and channel IDs
 * are rejected until the provider contract for those formats is established;
 * they are never guessed into URLs.
 */
export function normalizeReliableSMMTarget(input: { vantaSlug: string; targetType: VantaTargetType; targetValue: string }): VantaTargetValidation {
  if (getTargetContract(input.vantaSlug)) return normalizeTarget(input.vantaSlug, input.targetValue);
  if (input.vantaSlug === "instagram-views") return instagramViewTarget(input.targetValue);
  if (!["url", "post_url", "video_url", "username", "page", "channel"].includes(input.targetType)) return rejected("Unsupported VANTA target type.");
  if (["username", "page", "channel"].includes(input.targetType)) return rejected("This target type is not safely representable as a ReliableSMM link yet.");
  return httpsUrl(input.targetValue);
}

export function assertReliableSMMTarget(input: { vantaSlug: string; targetType: VantaTargetType; targetValue: string }): ReliableSMMTarget {
  const result = normalizeReliableSMMTarget(input);
  if (!result.valid) throw new Error(result.reason);
  return { link: result.target };
}
