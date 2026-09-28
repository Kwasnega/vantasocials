import "server-only";

export function reliableSMMCost(rate: string, quantity: number) {
  if (!/^\d+(\.\d+)?$/.test(rate) || !Number.isSafeInteger(quantity) || quantity < 0) throw new Error("Invalid ReliableSMM pricing input.");
  const [whole, fraction = ""] = rate.split("."); const scaled = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0").slice(0, 6)); const result = scaled * BigInt(quantity) / 1000n;
  const decimals = (result % 1000000n).toString().padStart(6, "0").replace(/0+$/, ""); return `${result / 1000000n}${decimals ? `.${decimals}` : ""}`;
}
