import { calculatePricing, normalizePricingValue, type RateUnit } from "../pricing/engine";

export type PricingRow = {
  id: string; slug: string; name: string; selling_rate: string | number; currency: string;
  provider: string | null; provider_service_id: string | null; provider_rate: string | number | null;
  provider_rate_unit: string | null; provider_currency: string | null; provider_rate_last_synced: string | null;
  min_quantity: number; max_quantity: number; active: boolean;
};

export function derivePricing(service: PricingRow, fxRate: string) {
  const unavailable = (reason: string) => ({
    status: "UNAVAILABLE" as const,
    reason,
    per1000: null,
    per10000: null,
  });
  if (service.provider_rate == null || service.provider_rate === "") return unavailable("Provider rate is missing.");
  if (!service.provider_rate_unit) return unavailable("Provider billing unit is missing.");
  if (!["PER_1000", "PER_ORDER"].includes(service.provider_rate_unit)) return unavailable("Provider billing unit is unsupported.");
  if (service.provider_currency !== "USD" || service.currency !== "GHS") return unavailable("Expected USD provider cost and GHS customer price.");
  try {
    const inputs = {
      providerRate: normalizePricingValue(service.provider_rate),
      providerRateUnit: service.provider_rate_unit as RateUnit,
      providerCurrency: "USD" as const,
      fxRate: normalizePricingValue(fxRate, false),
      sellingPricePerUnit: normalizePricingValue(service.selling_rate),
      sellingCurrency: "GHS" as const,
    };
    return {
      status: "AVAILABLE" as const,
      reason: null,
      per1000: calculatePricing({ ...inputs, quantity: 1000 }),
      per10000: calculatePricing({ ...inputs, quantity: 10000 }),
    };
  } catch (error) {
    const message = error && typeof error === "object" && "message" in error && typeof error.message === "string"
      ? error.message
      : "Pricing inputs are invalid.";
    return unavailable(message);
  }
}
