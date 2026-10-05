export type RateUnit = "PER_UNIT" | "PER_1000" | "PER_ORDER";
export type PricingInputs = { providerRate: string; providerRateUnit: RateUnit; providerCurrency: "USD"; fxRate: string; sellingPricePerUnit: string; sellingCurrency: "GHS"; quantity: number };
export type PricingResult = { previewQuantity: number; revenueGhs: string; providerCostUsd: string; providerCostGhs: string; providerCostGhsPerUnit: string; grossProfitGhs: string; grossProfitGhsPerUnit: string; grossMarginPercent: string | null; lossOrNoMargin: boolean };
export function toPricingString(value: string | number) { return String(value); }

function scaled(value: string, digits = 6) { if (!/^\d+(\.\d+)?$/.test(value.trim())) throw new Error("Invalid monetary value."); const [whole, fraction = ""] = value.trim().split("."); return BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, "0").slice(0, digits)); }
function format(value: bigint, digits = 6) { const negative = value < 0n; const absolute = negative ? -value : value; const fraction = (absolute % 10n ** BigInt(digits)).toString().padStart(digits, "0").replace(/0+$/, ""); return `${negative ? "-" : ""}${absolute / 10n ** BigInt(digits)}${fraction ? `.${fraction}` : ""}`; }

export function calculatePricing(input: PricingInputs): PricingResult {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) throw new Error("Quantity must be positive.");
  const rate = scaled(input.providerRate); const fx = scaled(input.fxRate); const selling = scaled(input.sellingPricePerUnit);
  if (rate < 0n || fx <= 0n || selling <= 0n) throw new Error("Pricing values must be positive.");
  const providerCostUsd = input.providerRateUnit === "PER_1000" ? rate * BigInt(input.quantity) / 1000n : input.providerRateUnit === "PER_ORDER" ? rate : rate * BigInt(input.quantity);
  const providerCostGhs = providerCostUsd * fx / 1000000n;
  const revenue = selling * BigInt(input.quantity); const profit = revenue - providerCostGhs;
  return { previewQuantity: input.quantity, revenueGhs: format(revenue), providerCostUsd: format(providerCostUsd), providerCostGhs: format(providerCostGhs), providerCostGhsPerUnit: format(providerCostGhs / BigInt(input.quantity)), grossProfitGhs: format(profit), grossProfitGhsPerUnit: format(profit / BigInt(input.quantity)), grossMarginPercent: revenue === 0n ? null : format(profit * 10000n / revenue, 2), lossOrNoMargin: providerCostGhs >= revenue };
}
