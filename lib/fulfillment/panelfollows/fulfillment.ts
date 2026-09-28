import "server-only";

import { PanelFollowsError, PanelFollowsReadOnlyClient, normalizeProviderService, type ProviderService } from "./client";
import { assertApprovedPanelFollowsService, validatePanelFollowsQuantity, validatePanelFollowsTarget } from "./validation";
import { panelFollowsIdempotencyKey } from "./idempotency";
import { providerCostForQuantity } from "./pricing";

export type FulfillmentPreview = { provider: "panelfollows"; providerServiceId: string; target: string; quantity: number; providerCost: string; currency: "USD"; balance: string; estimatedRemainingBalance: string; wouldFulfill: boolean; reason?: string };

function subtractMoney(balance: string, cost: string) {
  const toUnits = (value: string) => { const [whole, fraction = ""] = value.split("."); return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0").slice(0, 6)); };
  const result = toUnits(balance) - toUnits(cost); const negative = result < 0n; const abs = negative ? -result : result;
  const fraction = (abs % 1000000n).toString().padStart(6, "0").replace(/0+$/, ""); return `${negative ? "-" : ""}${abs / 1000000n}${fraction ? `.${fraction}` : ""}`;
}

export async function previewPanelFollowsFulfillment(input: { orderId: string; vantaSlug: string; target: string; quantity: number; provider: ProviderService; client?: PanelFollowsReadOnlyClient }): Promise<FulfillmentPreview> {
  const client = input.client || new PanelFollowsReadOnlyClient();
  assertApprovedPanelFollowsService(input.provider, input.vantaSlug);
  const target = validatePanelFollowsTarget(input.vantaSlug, input.target); if (!target.valid) throw new Error(target.reason);
  const quantity = validatePanelFollowsQuantity(input.quantity, input.provider); if (!quantity.valid) throw new Error(quantity.reason);
  const cost = providerCostForQuantity(input.provider.providerRate, input.provider.pricingUnit, input.quantity);
  const account = await client.getAccount();
  if (account.currency !== "USD") throw new Error("PanelFollows account currency is not supported.");
  const remaining = subtractMoney(account.balance, cost);
  return { provider: "panelfollows", providerServiceId: input.provider.providerServiceId, target: target.target, quantity: input.quantity, providerCost: cost, currency: "USD", balance: account.balance, estimatedRemainingBalance: remaining, wouldFulfill: !remaining.startsWith("-") && process.env.PANELS_LIVE_FULFILLMENT_ENABLED === "true", reason: process.env.PANELS_LIVE_FULFILLMENT_ENABLED === "true" ? undefined : "LIVE_FULFILLMENT_DISABLED" };
}

export function assertLiveFulfillmentEnabled() { if (process.env.PANELS_LIVE_FULFILLMENT_ENABLED !== "true") throw new PanelFollowsError("Live fulfillment is disabled.", 423, "LIVE_FULFILLMENT_DISABLED"); }

export { panelFollowsIdempotencyKey };
