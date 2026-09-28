import "server-only";

import type { ReliableSMMService } from "./client";

export type NormalizedReliableSMMService = {
  provider: "reliablesmm"; providerServiceId: string; name: string; type: string; category: string;
  providerRate: string; pricingUnit: "per_1000" | "unknown"; currency: "USD"; minQuantity: number; maxQuantity: number;
  refill: boolean; cancel: boolean; rawMetadata: Record<string, unknown>;
};

function integer(value: unknown) { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Invalid ReliableSMM quantity."); return parsed; }
function flag(value: unknown) { return value === true || value === 1 || value === "1" || value === "true"; }
function rate(value: unknown) { const result = String(value); if (!/^\d+(\.\d+)?$/.test(result)) throw new Error("Invalid ReliableSMM rate."); return result; }

export function normalizeReliableSMMService(service: ReliableSMMService): NormalizedReliableSMMService {
  const id = String(service.service); if (!/^\d+$/.test(id) || !service.name) throw new Error("Invalid ReliableSMM service.");
  return { provider: "reliablesmm", providerServiceId: id, name: service.name, type: String(service.type || ""), category: String(service.category || ""), providerRate: rate(service.rate), pricingUnit: "unknown", currency: "USD", minQuantity: integer(service.min), maxQuantity: integer(service.max), refill: flag(service.refill), cancel: flag(service.cancel), rawMetadata: { ...service } };
}

export function normalizeReliableSMMCatalog(services: ReliableSMMService[]) { return services.map(normalizeReliableSMMService); }
