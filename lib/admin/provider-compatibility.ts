import { TARGET_TYPES, type ServiceTargetType } from "./service-creation";

type Metadata = Record<string, unknown>;
export type ProviderCompatibility = { platform: string; targetType: ServiceTargetType };
export type ProviderCompatibilityState = "READY" | "MISSING_METADATA" | "UNSUPPORTED_TARGET";
export type CompatibilityState = "READY" | "MISSING_METADATA" | "UNSUPPORTED_TARGET" | "UNSUPPORTED_PLATFORM" | "PLATFORM_MISMATCH" | "PROVIDER_UNAVAILABLE" | "ALREADY_REPRESENTED";
export type PlatformCompatibilityState = "READY" | "MISSING_METADATA" | "PLATFORM_MISMATCH";

const KNOWN_PLATFORMS = [
  { platform: "instagram", keywords: ["instagram", "ig "] },
  { platform: "tiktok", keywords: ["tiktok", "tik tok"] },
  { platform: "youtube", keywords: ["youtube", "yt "] },
  { platform: "facebook", keywords: ["facebook", "fb "] },
  { platform: "x", keywords: ["twitter", "tweet", " x ", " x/"] },
  { platform: "telegram", keywords: ["telegram", "tg "] },
  { platform: "linkedin", keywords: ["linkedin"] },
  { platform: "spotify", keywords: ["spotify"] },
  { platform: "kick", keywords: ["kick"] },
  { platform: "discord", keywords: ["discord"] },
  { platform: "twitch", keywords: ["twitch"] },
  { platform: "pinterest", keywords: ["pinterest"] },
  { platform: "snapchat", keywords: ["snapchat", "snap"] },
  { platform: "reddit", keywords: ["reddit"] },
  { platform: "soundcloud", keywords: ["soundcloud"] },
  { platform: "threads", keywords: ["threads"] },
];

function text(metadata: Metadata, keys: string[]) {
  for (const key of keys) if (typeof metadata[key] === "string" && metadata[key].trim()) return metadata[key].trim().toLowerCase();
  return null;
}

export function detectPlatformFromText(nameAndCategory: string): string | null {
  const haystack = ` ${nameAndCategory.toLowerCase()} `;
  for (const p of KNOWN_PLATFORMS) {
    if (p.keywords.some((k) => haystack.includes(k))) {
      return p.platform;
    }
  }
  return null;
}

export function resolveProviderCompatibility(rawMetadata: unknown, name?: string): { state: ProviderCompatibilityState; compatibility?: ProviderCompatibility; reason: string } {
  const metadata = rawMetadata && typeof rawMetadata === "object" ? rawMetadata as Metadata : {};
  let platform = text(metadata, ["platform", "platform_name", "platformSlug", "platform_slug", "network"]);
  let target = text(metadata, ["target_type", "targetType", "input_type", "inputType"]);

  // If not explicitly in metadata, infer from name + category
  if (!platform && (name || metadata.category || metadata.name)) {
    const combined = `${name || ""} ${String(metadata.name || "")} ${String(metadata.category || "")}`;
    platform = detectPlatformFromText(combined);
  }

  // ReliableSMM services almost universally accept target URLs (or profile URLs)
  if (!target) {
    target = "url";
  }

  if (!platform) {
    return { state: "MISSING_METADATA", reason: "Provider platform could not be determined from catalog metadata." };
  }

  if (!(TARGET_TYPES as readonly string[]).includes(target)) {
    return { state: "UNSUPPORTED_TARGET", reason: "Provider target/input requirement is not supported by VANTA." };
  }

  return { state: "READY", compatibility: { platform, targetType: target as ServiceTargetType }, reason: "Ready to configure." };
}

export function sameProviderPlatform(providerPlatform: string, vantaPlatform: { name?: string; slug?: string | null }) {
  const normalized = providerPlatform.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const nameNorm = vantaPlatform.name ? vantaPlatform.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "";
  const slugNorm = String(vantaPlatform.slug ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-");

  // Handle aliases like twitter -> x
  const aliases: Record<string, string[]> = {
    x: ["twitter", "x"],
    twitter: ["twitter", "x"],
  };

  if (normalized === nameNorm || normalized === slugNorm) return true;
  if (aliases[normalized]?.includes(slugNorm) || aliases[slugNorm]?.includes(normalized)) return true;
  if (nameNorm && (aliases[normalized]?.includes(nameNorm) || aliases[nameNorm]?.includes(normalized))) return true;

  return false;
}

export function resolveProviderPlatformCompatibility(rawMetadata: unknown, vantaPlatform: { name?: string; slug?: string | null } | null, name?: string): { state: PlatformCompatibilityState; reason: string } {
  const metadata = rawMetadata && typeof rawMetadata === "object" ? rawMetadata as Metadata : {};
  let platform = text(metadata, ["platform", "platform_name", "platformSlug", "platform_slug", "network"]);

  if (!platform && (name || metadata.category || metadata.name)) {
    const combined = `${name || ""} ${String(metadata.name || "")} ${String(metadata.category || "")}`;
    platform = detectPlatformFromText(combined);
  }

  if (!platform || !vantaPlatform) return { state: "MISSING_METADATA", reason: "Provider platform metadata is incomplete." };
  if (!sameProviderPlatform(platform, vantaPlatform)) return { state: "PLATFORM_MISMATCH", reason: "Provider platform does not match the VANTA platform." };
  return { state: "READY", reason: "Provider platform matches the VANTA platform." };
}
