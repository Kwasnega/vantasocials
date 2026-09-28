import "server-only";

export function providerCostForQuantity(rate: string, unit: "per_1000" | "per_order", quantity: number) {
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error("Invalid quantity.");
  if (!/^\d+(\.\d+)?$/.test(rate.trim())) throw new Error("Invalid provider rate.");
  const [whole, fraction = ""] = rate.trim().split(".");
  const scale = 6;
  const rateScaled = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0").slice(0, scale));
  const costScaled = unit === "per_1000" ? (rateScaled * BigInt(quantity)) / 1000n : rateScaled;
  const wholeCost = costScaled / 10n ** BigInt(scale);
  const fractionCost = (costScaled % 10n ** BigInt(scale)).toString().padStart(scale, "0").replace(/0+$/, "");
  return fractionCost ? `${wholeCost}.${fractionCost}` : `${wholeCost}`;
}

export function validateProviderQuantity(vantaMin: number, vantaMax: number, providerMin: number, providerMax: number) {
  if (providerMin > vantaMin) return { compatible: false, reason: "PROVIDER_MIN_ABOVE_VANTA_MIN" as const };
  if (providerMax < vantaMax) return { compatible: false, reason: "PROVIDER_MAX_BELOW_VANTA_MAX" as const };
  return { compatible: true as const };
}
