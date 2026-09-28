import "server-only";

export type FulfillmentMapping = { provider: "panelfollows" | "reliablesmm"; vantaSlug: string; providerServiceId: string; active: boolean; status: "ACTIVE" | "MANUAL_REVIEW" };

export const fulfillmentMappings: readonly FulfillmentMapping[] = [
  { provider: "reliablesmm", vantaSlug: "instagram-views", providerServiceId: "7486", active: false, status: "MANUAL_REVIEW" },
];

export function resolveActiveMapping(vantaSlug: string) { return fulfillmentMappings.find((mapping) => mapping.vantaSlug === vantaSlug && mapping.active && mapping.status === "ACTIVE") || null; }
