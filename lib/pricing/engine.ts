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
  profitability: "PROFIT" | "BREAK_EVEN" | "LOSS";
  lossOrNoMargin: boolean;
};

export function toPricingString(value: string | number) {
  return String(value);
}

const PRECISION = 12;
const SCALE = 10n ** BigInt(PRECISION);

function scaled(value: string, digits = PRECISION): bigint {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) throw new Error("Invalid monetary value.");
  const [whole, fraction = ""] = trimmed.split(".");
  if (whole.replace(/^0+/, "").length > 12) throw new Error("Monetary value exceeds numeric(24,12) storage range.");
  if (fraction.length > digits) throw new Error(`Monetary value exceeds supported ${digits}-decimal precision.`);
  return BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, "0"));
}

function format(value: bigint, digits = PRECISION): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(digits);
  const wholePart = absolute / scale;
  const fracPart = (absolute % scale).toString().padStart(digits, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${wholePart}${fracPart ? `.${fracPart}` : ""}`;
}

export function normalizeProviderPricingValue(value: string, allowZero = true): string {
  const parsed = scaled(value);
  if (!allowZero && parsed === 0n) throw new Error("Pricing value must be greater than zero.");
  return format(parsed);
}

function expandScientificNotation(value: string): string {
  const match = /^(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(value);
  if (!match) return value;
  const [, whole, fraction = "", exponentText] = match;
  const digits = whole + fraction;
  const decimalPosition = whole.length + Number(exponentText);
  if (decimalPosition <= 0) return `0.${"0".repeat(-decimalPosition)}${digits}`;
  if (decimalPosition >= digits.length) return `${digits}${"0".repeat(decimalPosition - digits.length)}`;
  return `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
}

export function normalizePricingValue(value: string | number, allowZero = true): string {
  if (typeof value === "string") return normalizeProviderPricingValue(value, allowZero);
  if (!Number.isFinite(value) || value < 0) throw new Error("Pricing value must be a finite non-negative number.");
  const decimalValue = expandScientificNotation(String(value));
  const fraction = decimalValue.split(".")[1] ?? "";
  if (fraction.replace(/0+$/, "").length > PRECISION) {
    throw new Error("Numeric pricing value cannot be represented exactly at the supported precision.");
  }
  return normalizeProviderPricingValue(decimalValue, allowZero);
}

export function formatGhsAmount(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error("Invalid GHS amount.");
  const [, sign, whole, fraction = ""] = match;
  const scale = 10n ** BigInt(fraction.length);
  const amount = BigInt(whole) * scale + BigInt(fraction || "0");
  const cents = divideRounded(amount * 100n, scale);
  return `${sign && cents !== 0n ? "-" : ""}${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("Pricing denominator must be positive.");
  return (numerator + denominator / 2n) / denominator;
}

function percent(value: bigint, denominator: bigint): string | null {
  if (denominator === 0n) return null;
  const negative = (value < 0n) !== (denominator < 0n);
  const absoluteNumerator = (value < 0n ? -value : value) * 10000n;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const rounded = divideRounded(absoluteNumerator, absoluteDenominator);
  return format(negative ? -rounded : rounded, 2);
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

  // All provider rates and FX values use the database's 12 decimal places.
  // For PER_1000: costUsd = rate * qty / 1000
  // For PER_ORDER: costUsd = rate
  // For PER_UNIT: costUsd = rate * qty
  const providerCostUsd =
    input.providerRateUnit === "PER_1000"
      ? divideRounded(rate * qty, 1000n)
      : input.providerRateUnit === "PER_ORDER"
      ? rate
      : rate * qty;

  // Multiply at full precision, then round once to 12 decimal places.
  const providerCostGhs = divideRounded(providerCostUsd * fx, SCALE);

  // Customer pricing is per unit and is independent of provider billing basis.
  const revenueGhs = selling * qty;

  const profit = revenueGhs - providerCostGhs;

  // Cost per basis (per 1000 for PER_1000, per order for PER_ORDER, per unit for PER_UNIT)
  const providerCostGhsPerBasisBig =
    input.providerRateUnit === "PER_1000"
      ? divideRounded(rate * fx, SCALE)
      : input.providerRateUnit === "PER_ORDER"
      ? providerCostGhs
      : divideRounded(rate * fx, SCALE);

  const providerCostGhsPerBasis = format(providerCostGhsPerBasisBig);

  // Profit margin (%) = (profit / revenue) * 100
  // Markup (%) = (profit / providerCost) * 100
  const grossMarginPercent = percent(profit, revenueGhs);
  const markupPercent = percent(profit, providerCostGhs);

  const sellingPer1000Big = selling * 1000n;
  const providerCostPer1000Big = input.providerRateUnit === "PER_ORDER"
    ? null
    : input.providerRateUnit === "PER_1000"
    ? divideRounded(rate * fx, SCALE)
    : divideRounded(rate * fx, SCALE) * 1000n;
  const sellingPriceGhsPer1000 = format(sellingPer1000Big);
  const providerCostGhsPer1000 = providerCostPer1000Big === null ? null : format(providerCostPer1000Big);
  const grossProfitGhsPer1000 = providerCostPer1000Big === null
    ? null
    : format(sellingPer1000Big - providerCostPer1000Big);

  const projectionQuantity = 10000n;
  const projectionProviderCostUsd = input.providerRateUnit === "PER_1000"
    ? divideRounded(rate * projectionQuantity, 1000n)
    : input.providerRateUnit === "PER_ORDER"
    ? rate
    : rate * projectionQuantity;
  const projectionProviderCostGhs = divideRounded(projectionProviderCostUsd * fx, SCALE);
  const projectionRevenueGhs = selling * projectionQuantity;
  const projection10k: PricingResult["projection10k"] = {
    quantity: 10000,
    revenueGhs: format(projectionRevenueGhs),
    providerCostGhs: format(projectionProviderCostGhs),
    profitGhs: format(projectionRevenueGhs - projectionProviderCostGhs),
  };
  const profitPerUnit = profit / qty;
  const profitability = profit > 0n ? "PROFIT" : profit < 0n ? "LOSS" : "BREAK_EVEN";

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
    profitability,
    lossOrNoMargin: profitability === "LOSS",
  };
}
