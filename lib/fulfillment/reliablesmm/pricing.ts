import "server-only";

export type ReliableSMMRateUnit = "PER_1000" | "PER_ORDER";

export function reliableSMMCost(rate: string, quantity: number, rateUnit: string) {
  if (!/^\d+(\.\d+)?$/.test(rate) || !Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error("Invalid ReliableSMM pricing input.");
  }
  if (rateUnit !== "PER_1000" && rateUnit !== "PER_ORDER") {
    throw new Error(`Unsupported ReliableSMM pricing unit: ${rateUnit || "UNKNOWN"}.`);
  }
  const [whole, fraction = ""] = rate.split(".");
  const scaled = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0").slice(0, 6));
  const result = rateUnit === "PER_1000" ? scaled * BigInt(quantity) / 1000n : scaled;
  const decimals = (result % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${result / 1000000n}${decimals ? `.${decimals}` : ""}`;
}
