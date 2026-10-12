export type RateUnit = "PER_UNIT" | "PER_1000" | "PER_ORDER";

export type PricingInputs = {
  providerRate: string;
  providerRateUnit: RateUnit;
  providerCurrency: "USD";
  fxRate: string;
  sellingPricePerUnit: string;
  sellingCurrency: "GHS";
  quantity: number;
};

export type PricingResult = {
  previewQuantity: number;
  revenueGhs: string;
  providerCostUsd: string;
  providerCostGhs: string;
  providerCostGhsPerUnit: string;
  providerCostGhsPerBasis: string;
  providerCostGhsPer1000: string | null;
  sellingPriceGhsPer1000: string | null;
  grossProfitGhs: string;
  grossProfitGhsPerUnit: string;
  grossProfitGhsPer1000: string | null;
  grossMarginPercent: string | null;
  markupPercent: string | null;
  projection10k: {
    quantity: number;
    revenueGhs: string;
    providerCostGhs: string;
    profitGhs: string;
  } | null;
  lossOrNoMargin: boolean;
};

export function toPricingString(value: string | number) {
  return String(value);
}

function scaled(value: string, digits = 6): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error("Invalid monetary value.");
  const [whole, fraction = ""] = trimmed.split(".");
  return BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, "0").slice(0, digits));
}

function format(value: bigint, digits = 6): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(digits);
  const wholePart = absolute / scale;
  const fracPart = (absolute % scale).toString().padStart(digits, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${wholePart}${fracPart ? `.${fracPart}` : ""}`;
}

export function calculatePricing(input: PricingInputs): PricingResult {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    throw new Error("Quantity must be positive.");
  }
  if (!["PER_UNIT", "PER_1000", "PER_ORDER"].includes(input.providerRateUnit)) {
    throw new Error(`Unsupported provider pricing unit: ${String(input.providerRateUnit)}.`);
  }

  const rate = scaled(input.providerRate);
  const fx = scaled(input.fxRate);
  const selling = scaled(input.sellingPricePerUnit);

  if (rate < 0n || fx <= 0n || selling < 0n) {
    throw new Error("Pricing values must be non-negative.");
  }

  const qty = BigInt(input.quantity);

  // Calculate provider cost in USD scaled (1e6)
  // For PER_1000: costUsd = rate * qty / 1000
  // For PER_ORDER: costUsd = rate
  // For PER_UNIT: costUsd = rate * qty
  const providerCostUsd =
    input.providerRateUnit === "PER_1000"
      ? (rate * qty) / 1000n
      : input.providerRateUnit === "PER_ORDER"
      ? rate
      : rate * qty;

  // Convert to GHS: (costUsd * fx) / 1e6
  const providerCostGhs = (providerCostUsd * fx) / 1000000n;

  // Customer pricing is per unit and is independent of provider billing basis.
  const revenueGhs = selling * qty;

  const profit = revenueGhs - providerCostGhs;

  // Cost per basis (per 1000 for PER_1000, per order for PER_ORDER, per unit for PER_UNIT)
  const providerCostGhsPerBasisBig =
    input.providerRateUnit === "PER_1000"
      ? (rate * fx) / 1000000n
      : input.providerRateUnit === "PER_ORDER"
      ? providerCostGhs
      : (rate * fx) / 1000000n;

  const providerCostGhsPerBasis = format(providerCostGhsPerBasisBig);

  // Profit margin (%) = (profit / revenue) * 100
  // Markup (%) = (profit / providerCost) * 100
  const grossMarginPercent =
    revenueGhs === 0n
      ? null
      : format((profit * 10000n) / revenueGhs, 2);

  const markupPercent =
    providerCostGhs === 0n
      ? null
      : format((profit * 10000n) / providerCostGhs, 2);

  const sellingPer1000Big = selling * 1000n;
  const providerCostPer1000Big = input.providerRateUnit === "PER_ORDER"
    ? null
    : input.providerRateUnit === "PER_1000"
    ? (rate * fx) / 1000000n
    : ((rate * fx) / 1000000n) * 1000n;
  const sellingPriceGhsPer1000 = format(sellingPer1000Big);
  const providerCostGhsPer1000 = providerCostPer1000Big === null ? null : format(providerCostPer1000Big);
  const grossProfitGhsPer1000 = providerCostPer1000Big === null
    ? null
    : format(sellingPer1000Big - providerCostPer1000Big);

  const projectionQuantity = 10000n;
  const projectionProviderCostUsd = input.providerRateUnit === "PER_1000"
    ? (rate * projectionQuantity) / 1000n
    : input.providerRateUnit === "PER_ORDER"
    ? rate
    : rate * projectionQuantity;
  const projectionProviderCostGhs = (projectionProviderCostUsd * fx) / 1000000n;
  const projectionRevenueGhs = selling * projectionQuantity;
  const projection10k: PricingResult["projection10k"] = {
    quantity: 10000,
    revenueGhs: format(projectionRevenueGhs),
    providerCostGhs: format(projectionProviderCostGhs),
    profitGhs: format(projectionRevenueGhs - projectionProviderCostGhs),
  };
  const profitPerUnit = profit / qty;

  return {
    previewQuantity: input.quantity,
    revenueGhs: format(revenueGhs),
    providerCostUsd: format(providerCostUsd),
    providerCostGhs: format(providerCostGhs),
    providerCostGhsPerUnit: providerCostGhsPerBasis,
    providerCostGhsPerBasis,
    providerCostGhsPer1000,
    sellingPriceGhsPer1000,
    grossProfitGhs: format(profit),
    grossProfitGhsPerUnit: format(profitPerUnit),
    grossProfitGhsPer1000,
    grossMarginPercent,
    markupPercent,
    projection10k,
    lossOrNoMargin: providerCostGhs >= revenueGhs,
  };
}
