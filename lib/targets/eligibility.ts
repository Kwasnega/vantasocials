import type { TargetContract } from "./contracts";
import { effectiveQuantityBounds, getTargetContract } from "./contracts";

export type EligibilityStatus = "ELIGIBLE" | "MANUAL_REVIEW" | "BLOCKED";
export type ProviderCandidate = { provider: string; provider_service_id: string; name: string; provider_status: string; provider_currency: string; rate_unit: string; min_quantity: number; max_quantity: number; raw_metadata?: unknown };
const approved: Record<string, string[]> = { "instagram-likes": ["5911"], "instagram-views": ["7486"], "instagram-saves": ["7841"], "tiktok-followers": ["7054"], "tiktok-views": ["5661"], "tiktok-shares": ["7580"], "youtube-subscribers": ["7458"], "youtube-likes": ["4210"], "facebook-page-followers": ["7229"], "facebook-post-likes": ["7099"], "facebook-video-views": ["7603"] };

export function assessProviderEligibility(input: { serviceSlug: string; targetContract?: TargetContract | null; dynamicCompatibilityVerified?: boolean; platformCompatibilityState?: "READY" | "MISSING_METADATA" | "PLATFORM_MISMATCH"; vantaMin: number; vantaMax: number; provider: ProviderCandidate }): { status: EligibilityStatus; reason: string; effectiveMin?: number; effectiveMax?: number } {
  const { provider, serviceSlug } = input;
  if (input.platformCompatibilityState && input.platformCompatibilityState !== "READY") {
    return { status: "BLOCKED", reason: input.platformCompatibilityState === "PLATFORM_MISMATCH" ? "Provider platform does not match the VANTA platform." : "Provider platform metadata is incomplete." };
  }
  if (!input.targetContract || (!getTargetContract(serviceSlug) && !input.dynamicCompatibilityVerified)) {
    return { status: "BLOCKED", reason: "No supported VANTA target contract." };
  }
  if (provider.provider !== "reliablesmm" || provider.provider_status !== "ACTIVE") return { status: "BLOCKED", reason: "Provider mapping is not active and supported." };
  if (provider.provider_currency !== "USD" || !["PER_1000", "PER_ORDER"].includes(provider.rate_unit)) return { status: "BLOCKED", reason: "Provider accounting metadata is unsupported." };
  if (/custom comments|emoji comments|reaction|random comments|ai comments|auto/i.test(`${provider.name} ${JSON.stringify(provider.raw_metadata ?? {})}`)) return { status: "BLOCKED", reason: "Provider service requires unsupported special semantics." };
  const bounds = effectiveQuantityBounds(input.vantaMin, input.vantaMax, provider.min_quantity, provider.max_quantity);
  if (bounds.min > bounds.max) return { status: "BLOCKED", reason: "VANTA and provider quantity ranges do not overlap." };
  if ((approved[serviceSlug] ?? []).includes(provider.provider_service_id) || input.dynamicCompatibilityVerified) {
    return { status: "ELIGIBLE", reason: "Provider service passed the validated VANTA/provider compatibility gates.", effectiveMin: bounds.min, effectiveMax: bounds.max };
  }
  return { status: "MANUAL_REVIEW", reason: "Provider target compatibility is not formally documented or approved.", effectiveMin: bounds.min, effectiveMax: bounds.max };
}
