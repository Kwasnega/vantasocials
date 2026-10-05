export type QuantityRange = { min: number; max: number };

export function effectiveQuantityRange(vantaMin: number, vantaMax: number, providerMin?: number | null, providerMax?: number | null): QuantityRange {
  if (providerMin == null || providerMax == null) return { min: vantaMin, max: vantaMax };
  return { min: Math.max(vantaMin, providerMin), max: Math.min(vantaMax, providerMax) };
}

export function quantityInRange(quantity: number, range: QuantityRange) {
  return Number.isSafeInteger(quantity) && quantity >= range.min && quantity <= range.max;
}
