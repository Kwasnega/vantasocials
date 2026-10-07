import "server-only";

import { calculatePricing, toPricingString, type RateUnit } from "../pricing/engine";

export type PricingRow = {
  id: string; slug: string; name: string; selling_rate: string; currency: string;
  provider: string | null; provider_service_id: string | null; provider_rate: string | null;
  provider_rate_unit: RateUnit | null; provider_currency: string | null; provider_rate_last_synced: string | null;
  min_quantity: number; max_quantity: number; active: boolean;
};

export function derivePricing(service: PricingRow, fxRate: string) {
  if (!service.provider_rate || !service.provider_rate_unit || service.provider_currency !== "USD" || service.currency !== "GHS") return { previewQuantity: 10000, revenueGhs: null, providerCostUsd: null, providerCostGhs: null, providerCostGhsPerUnit: null, providerCostGhsPerBasis: null, grossProfitGhs: null, grossProfitGhsPerUnit: null, grossMarginPercent: null, lossOrNoMargin: null };
  return calculatePricing({ providerRate: toPricingString(service.provider_rate), providerRateUnit: service.provider_rate_unit, providerCurrency: "USD", fxRate: toPricingString(fxRate), sellingPricePerUnit: toPricingString(service.selling_rate), sellingCurrency: "GHS", quantity: 10000 });
}
