import "server-only";

import { claimPanelFollowsAttempt, submitPanelFollowsAttempt } from "./panelfollows/attempt";
import { resolveProviderForService } from "./resolver";
import { fulfillReliableSMMOrder } from "./reliablesmm/attempt";

/**
 * The single fulfillment entry point for a paid VANTA order.
 * Payment settlement remains responsible only for marking payment PAID;
 * callers should enqueue/call this worker after that transition.
 */
export async function fulfillPaidOrder(input: { orderId: string; vantaSlug: string; targetType: "username" | "url" | "post_url" | "video_url" | "channel" | "page"; targetValue: string; quantity: number }) {
  const provider = await resolveProviderForService(input.vantaSlug);
  if (provider?.mapping.provider === "reliablesmm") return { outcome: "SUBMITTED" as const, attempt: await fulfillReliableSMMOrder(input) };
  const claimed = await claimPanelFollowsAttempt(input.orderId, input.vantaSlug, input.targetValue, input.quantity);
  if (claimed.kind === "existing") return { outcome: "EXISTING_ATTEMPT" as const, attempt: claimed.attempt };
  try {
    const submitted = await submitPanelFollowsAttempt(claimed.attempt.id);
    return { outcome: "SUBMITTED" as const, attempt: submitted };
  } catch (error) {
    return { outcome: error instanceof Error ? error.message : "FULFILLMENT_BLOCKED" as const, attempt: claimed.attempt };
  }
}
