import "server-only";

export const reliableSMMProductionMappings: ReadonlyArray<{ vantaSlug: string; provider: "reliablesmm"; providerServiceId: string; target: string; active: boolean; status: "ACTIVE" | "MANUAL_REVIEW" }> = [{ vantaSlug: "instagram-views", provider: "reliablesmm", providerServiceId: "7486", target: "instagram_post_or_reel_url", active: false, status: "MANUAL_REVIEW" }];

export function resolveReliableSMMMapping(vantaSlug: string) {
  return reliableSMMProductionMappings.find((mapping) => mapping.vantaSlug === vantaSlug && mapping.active) || null;
}
