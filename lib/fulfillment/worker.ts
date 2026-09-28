import "server-only";

import { claimPanelFollowsAttempt, submitPanelFollowsAttempt } from "./panelfollows/attempt";
import { reliableSMMProductionMappings } from "./reliablesmm/mapping";
import { resolveProviderForService } from "./resolver";
import { fulfillReliableSMMOrder } from "./reliablesmm/attempt";

/**
 * The single fulfillment entry point for a paid VANTA order.
 * Payment settlement remains responsible only for marking payment PAID;
 * callers should enqueue/call this worker after that transition.
 */
export async function fulfillPaidOrder(input: { orderId: string; vantaSlug: string; targetValue: string; quantity: number }) {
  const reliableMapping = reliableSMMProductionMappings.find((mapping) => mapping.vantaSlug === input.vantaSlug);
  if (reliableMapping && !reliableMapping.active) throw new Error("ReliableSMM mapping is inactive and requires manual review.");
  if (resolveProviderForService(input.vantaSlug)?.mapping.provider === "reliablesmm") return { outcome: "SUBMITTED" as const, attempt: await fulfillReliableSMMOrder(input) };
  const claimed = await claimPanelFollowsAttempt(input.orderId, input.vantaSlug, input.targetValue, input.quantity);
  if (claimed.kind === "existing") return { outcome: "EXISTING_ATTEMPT" as const, attempt: claimed.attempt };
  try {
    const submitted = await submitPanelFollowsAttempt(claimed.attempt.id);
    return { outcome: "SUBMITTED" as const, attempt: submitted };
  } catch (error) {
    return { outcome: error instanceof Error ? error.message : "FULFILLMENT_BLOCKED" as const, attempt: claimed.attempt };
  }
}
