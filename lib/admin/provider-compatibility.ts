import { TARGET_TYPES, type ServiceTargetType } from "./service-creation";

type Metadata = Record<string, unknown>;
export type ProviderCompatibility = { platform: string; targetType: ServiceTargetType };
export type ProviderCompatibilityState = "READY" | "MISSING_METADATA" | "UNSUPPORTED_TARGET";
export type CompatibilityState = "READY" | "MISSING_METADATA" | "UNSUPPORTED_TARGET" | "UNSUPPORTED_PLATFORM" | "PLATFORM_MISMATCH" | "PROVIDER_UNAVAILABLE" | "ALREADY_REPRESENTED";
export type PlatformCompatibilityState = "READY" | "MISSING_METADATA" | "PLATFORM_MISMATCH";

function text(metadata: Metadata, keys: string[]) {
  for (const key of keys) if (typeof metadata[key] === "string" && metadata[key].trim()) return metadata[key].trim().toLowerCase();
  return null;
}

export function resolveProviderCompatibility(rawMetadata: unknown): { state: ProviderCompatibilityState; compatibility?: ProviderCompatibility; reason: string } {
  const metadata = rawMetadata && typeof rawMetadata === "object" ? rawMetadata as Metadata : {};
  const platform = text(metadata, ["platform", "platform_name", "platformSlug", "platform_slug", "network"]);
  const target = text(metadata, ["target_type", "targetType", "input_type", "inputType"]);
  if (!platform || !target) return { state: "MISSING_METADATA", reason: "Provider platform or target/input metadata is incomplete." };
  if (!(TARGET_TYPES as readonly string[]).includes(target)) return { state: "UNSUPPORTED_TARGET", reason: "Provider target/input requirement is not supported by VANTA." };
  return { state: "READY", compatibility: { platform, targetType: target as ServiceTargetType }, reason: "Ready to configure." };
}

export function sameProviderPlatform(providerPlatform: string, vantaPlatform: { name?: string; slug?: string | null }) {
  const normalized = providerPlatform.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return Boolean(vantaPlatform.name && normalized === vantaPlatform.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")) || normalized === String(vantaPlatform.slug ?? "").toLowerCase();
}

export function resolveProviderPlatformCompatibility(rawMetadata: unknown, vantaPlatform: { name?: string; slug?: string | null } | null): { state: PlatformCompatibilityState; reason: string } {
  const metadata = rawMetadata && typeof rawMetadata === "object" ? rawMetadata as Metadata : {};
  const platform = text(metadata, ["platform", "platform_name", "platformSlug", "platform_slug", "network"]);
  if (!platform || !vantaPlatform) return { state: "MISSING_METADATA", reason: "Provider platform metadata is incomplete." };
  if (!sameProviderPlatform(platform, vantaPlatform)) return { state: "PLATFORM_MISMATCH", reason: "Provider platform does not match the VANTA platform." };
  return { state: "READY", reason: "Provider platform matches the VANTA platform." };
}
