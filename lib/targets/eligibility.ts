import type { TargetContract } from "./contracts";
import { effectiveQuantityBounds } from "./contracts";

export type EligibilityStatus = "ELIGIBLE" | "MANUAL_REVIEW" | "BLOCKED";
export type ProviderCandidate = { provider: string; provider_service_id: string; name: string; provider_status: string; provider_currency: string; provider_rate: number | string; rate_unit: string; min_quantity: number; max_quantity: number; raw_metadata?: unknown };

export function assessProviderEligibility(input: { serviceSlug: string; targetContract?: TargetContract | null; operationCompatibilityVerified?: boolean; expectedTargetType?: string | null; providerTargetType?: string | null; platformCompatibilityState?: "READY" | "MISSING_METADATA" | "PLATFORM_MISMATCH"; vantaMin: number; vantaMax: number; provider: ProviderCandidate }): { status: EligibilityStatus; reason: string; effectiveMin?: number; effectiveMax?: number } {
  const { provider, serviceSlug } = input;
  if (input.platformCompatibilityState !== "READY") {
    return { status: "BLOCKED", reason: input.platformCompatibilityState === "PLATFORM_MISMATCH" ? "Provider platform does not match the VANTA platform." : "Provider platform metadata is incomplete." };
  }
  if (!input.targetContract) {
    return { status: "BLOCKED", reason: "No supported VANTA target contract." };
  }
  if (!/^\d+$/.test(provider.provider_service_id) || !provider.name.trim()) {
    return { status: "BLOCKED", reason: "Provider service identity is incomplete." };
  }
  const metadata = provider.raw_metadata && typeof provider.raw_metadata === "object" && !Array.isArray(provider.raw_metadata)
    ? provider.raw_metadata as Record<string, unknown>
    : null;
  if (
    metadata &&
    ((metadata.service != null && String(metadata.service) !== provider.provider_service_id) ||
      (typeof metadata.name === "string" && metadata.name.trim() !== provider.name.trim()))
  ) {
    return { status: "BLOCKED", reason: "Provider service identity metadata conflicts with the catalog entry." };
  }
  if (!input.expectedTargetType) {
    return { status: "BLOCKED", reason: "VANTA service target type is missing." };
  }
  const providerTargetMetadataUnavailable = !input.providerTargetType;
  const compatibleUrlTargetTypes = new Set([input.expectedTargetType, input.providerTargetType]);
  if (
    input.providerTargetType &&
    input.providerTargetType !== input.expectedTargetType &&
    !(compatibleUrlTargetTypes.size === 2 && compatibleUrlTargetTypes.has("url") && compatibleUrlTargetTypes.has("post_url"))
  ) {
    return { status: "BLOCKED", reason: `Provider target type '${input.providerTargetType}' is incompatible with VANTA target type '${input.expectedTargetType}'.` };
  }
  if (provider.provider !== "reliablesmm" || provider.provider_status !== "ACTIVE") return { status: "BLOCKED", reason: "Provider mapping is not active and supported." };
  if (
    provider.provider_currency !== "USD" ||
    !/^\d+(\.\d+)?$/.test(String(provider.provider_rate)) ||
    !["PER_1000", "PER_ORDER"].includes(provider.rate_unit)
  ) return { status: "BLOCKED", reason: "Provider accounting metadata is unsupported." };
  if (/custom comments|emoji comments|reaction|random comments|ai comments|auto/i.test(`${provider.name} ${JSON.stringify(provider.raw_metadata ?? {})}`)) return { status: "BLOCKED", reason: "Provider service requires unsupported special semantics." };
  if (![input.vantaMin, input.vantaMax, provider.min_quantity, provider.max_quantity].every(Number.isSafeInteger) || input.vantaMin <= 0 || input.vantaMax < input.vantaMin || provider.min_quantity <= 0 || provider.max_quantity < provider.min_quantity) {
    return { status: "BLOCKED", reason: "VANTA or provider quantity bounds are invalid." };
  }
  const bounds = effectiveQuantityBounds(input.vantaMin, input.vantaMax, provider.min_quantity, provider.max_quantity);
  if (bounds.min > bounds.max) return { status: "BLOCKED", reason: "VANTA and provider quantity ranges do not overlap." };
  if (input.operationCompatibilityVerified) {
    return {
      status: "ELIGIBLE",
      reason: providerTargetMetadataUnavailable
        ? "Provider target metadata is unavailable; the selected VANTA target mapping and provider operation were explicitly reviewed."
        : "Provider service identity and operation passed the reviewed VANTA/provider compatibility gates.",
      effectiveMin: bounds.min,
      effectiveMax: bounds.max,
    };
  }
  if (providerTargetMetadataUnavailable) return { status: "MANUAL_REVIEW", reason: "Provider target metadata is unavailable; confirm the target field before mapping.", effectiveMin: bounds.min, effectiveMax: bounds.max };
  return { status: "MANUAL_REVIEW", reason: "This exact provider service ID is not approved for this VANTA operation and requires manual review.", effectiveMin: bounds.min, effectiveMax: bounds.max };
}
