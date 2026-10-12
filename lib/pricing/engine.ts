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

  // Customer revenue in GHS: selling * qty (or selling for PER_ORDER)
  const revenueGhs =
    input.providerRateUnit === "PER_ORDER"
      ? selling
      : selling * qty;

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

  // For PER_1000 and PER_UNIT, calculate per-1,000 metrics and 10,000-unit projection
  let providerCostGhsPer1000: string | null = null;
  let sellingPriceGhsPer1000: string | null = null;
  let grossProfitGhsPer1000: string | null = null;
  let projection10k: PricingResult["projection10k"] = null;

  if (input.providerRateUnit === "PER_1000") {
    // rate is per 1000
    const costPer1000Big = (rate * fx) / 1000000n;
    const revPer1000Big = selling * 1000n;
    const profitPer1000Big = revPer1000Big - costPer1000Big;

    providerCostGhsPer1000 = format(costPer1000Big);
    sellingPriceGhsPer1000 = format(revPer1000Big);
    grossProfitGhsPer1000 = format(profitPer1000Big);

    // 10,000 units = 10 * 1,000 units
    const cost10k = costPer1000Big * 10n;
    const rev10k = revPer1000Big * 10n;
    const profit10k = rev10k - cost10k;

    projection10k = {
      quantity: 10000,
      revenueGhs: format(rev10k),
      providerCostGhs: format(cost10k),
      profitGhs: format(profit10k),
    };
  } else if (input.providerRateUnit === "PER_UNIT") {
    const costPerUnitBig = (rate * fx) / 1000000n;
    const costPer1000Big = costPerUnitBig * 1000n;
    const revPer1000Big = selling * 1000n;
    const profitPer1000Big = revPer1000Big - costPer1000Big;

    providerCostGhsPer1000 = format(costPer1000Big);
    sellingPriceGhsPer1000 = format(revPer1000Big);
    grossProfitGhsPer1000 = format(profitPer1000Big);

    const cost10k = costPer1000Big * 10n;
    const rev10k = revPer1000Big * 10n;
    const profit10k = rev10k - cost10k;

    projection10k = {
      quantity: 10000,
      revenueGhs: format(rev10k),
      providerCostGhs: format(cost10k),
      profitGhs: format(profit10k),
    };
  } else if (input.providerRateUnit === "PER_ORDER") {
    // PER_ORDER does not have 10k unit projection
    providerCostGhsPer1000 = null;
    sellingPriceGhsPer1000 = null;
    grossProfitGhsPer1000 = null;
    projection10k = null;
  }

  const profitPerUnit =
    input.providerRateUnit === "PER_ORDER"
      ? profit
      : profit / qty;

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
