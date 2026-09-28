import "server-only";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ReliableSMMReadOnlyClient, type ReliableSMMService } from "./client";

const approved = new Set(["7486", "5661", "7603"]);
type CachedCandidate = { id: string; name: string; type: string; category: string; rate: string; min: number; max: number; refill: unknown; cancel: unknown; metadata: ReliableSMMService };

function scaled(value: string) { const [whole, fraction = ""] = value.split("."); return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0").slice(0, 6)); }
function format(value: bigint) { const fraction = (value % 1000000n).toString().padStart(6, "0").replace(/0+$/, ""); return `${value / 1000000n}${fraction ? `.${fraction}` : ""}`; }

export async function runR4Test(input: { serviceId: string; link: string; quantity: number }) {
  if (process.env.R4_TEST_MODE !== "true") throw new Error("Refusing to run: R4_TEST_MODE=true is required.");
  if (!approved.has(input.serviceId) || input.quantity !== 100) throw new Error("Refusing to run: only services 7486, 5661, 7603 at quantity 100 are allowed.");
  const target = new URL(input.link);
  if (target.protocol !== "https:" || target.hostname === "localhost" || target.hostname === "127.0.0.1" || target.hostname === "::1") throw new Error("Refusing to run: target must be a public HTTPS URL.");
  if (!process.env.RELIABLESMM_API_KEY) throw new Error("Refusing to run: RELIABLESMM_API_KEY is missing.");
  const catalogPath = path.join(process.cwd(), "scripts", "reliablesmm-r1-live.json");
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as { candidates: Record<string, CachedCandidate[]> };
  const service = Object.values(catalog.candidates).flat().find((candidate) => candidate.id === input.serviceId);
  if (!service) throw new Error("Refusing to run: service is not present in the cached catalog.");
  if (input.quantity < service.min || input.quantity > service.max) throw new Error("Refusing to run: quantity is outside provider limits.");
  const client = new ReliableSMMReadOnlyClient();
  const before = await client.getBalance();
  const per1000Cost = scaled(service.rate) * BigInt(input.quantity) / 1000n;
  if (per1000Cost > 20000n || scaled(service.rate) > 20000n) throw new Error("Refusing to run: conservative cost ceiling exceeded.");
  const preflight = { serviceId: input.serviceId, name: service.name, type: service.type, category: service.category, rate: service.rate, min: service.min, max: service.max, refill: service.refill, cancel: service.cancel, quantity: input.quantity, targetUrlHash: crypto.createHash("sha256").update(input.link).digest("hex"), balanceBefore: before.balance, currency: before.currency, per1000Cost: format(per1000Cost), perOrderCost: service.rate, costCeiling: "0.02" };
  const submitted = await client.createR4TestOrder({ service: Number(input.serviceId), link: input.link, quantity: 100 });
  const providerOrderId = String(submitted.order);
  const status = await client.getStatus(providerOrderId);
  const after = await client.getBalance();
  return { preflight, providerOrderId, status, balanceAfter: after };
}
