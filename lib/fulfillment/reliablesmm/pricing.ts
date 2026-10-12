import "server-only";
import { normalizeProviderPricingValue } from "../../pricing/engine";

export type ReliableSMMRateUnit = "PER_1000" | "PER_ORDER";

const RATE_SCALE = 10n ** 12n;
const COST_STORAGE_SCALE = 10n ** 6n;

export function reliableSMMCost(rate: string, quantity: number, rateUnit: string) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error("Invalid ReliableSMM pricing input.");
  }
  if (rateUnit !== "PER_1000" && rateUnit !== "PER_ORDER") {
    throw new Error(`Unsupported ReliableSMM pricing unit: ${rateUnit || "UNKNOWN"}.`);
  }
  const normalizedRate = normalizeProviderPricingValue(rate);
  const [whole, fraction = ""] = normalizedRate.split(".");
  const rateScaled = BigInt(whole) * RATE_SCALE + BigInt(fraction.padEnd(12, "0"));
  const providerCostAt12 = rateUnit === "PER_1000"
    ? divideRounded(rateScaled * BigInt(quantity), 1000n)
    : rateScaled;
  const costAt6 = divideRounded(providerCostAt12, 10n ** 6n);
  if (providerCostAt12 > 0n && costAt6 === 0n) {
    throw new Error("Provider cost is below the six-decimal precision supported by provider_orders.provider_cost.");
  }
  if (costAt6 > 10n ** 18n - 1n) {
    throw new Error("Provider cost exceeds the numeric(18,6) storage range.");
  }
  const wholeCost = costAt6 / COST_STORAGE_SCALE;
  const fractionCost = (costAt6 % COST_STORAGE_SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return `${wholeCost}${fractionCost ? `.${fractionCost}` : ""}`;
}

function divideRounded(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}
