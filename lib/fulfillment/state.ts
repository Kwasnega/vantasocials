import "server-only";

export type FulfillmentStatus = "NOT_STARTED" | "SUBMITTING" | "SUBMITTED" | "PROCESSING" | "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";

const transitions: Record<FulfillmentStatus, readonly FulfillmentStatus[]> = {
  NOT_STARTED: ["SUBMITTING"],
  SUBMITTING: ["SUBMITTED", "FAILED"],
  SUBMITTED: ["PROCESSING", "FAILED", "CANCELLED"],
  PROCESSING: ["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"],
  COMPLETED: [],
  PARTIAL: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransitionFulfillment(from: FulfillmentStatus, to: FulfillmentStatus) {
  return transitions[from].includes(to);
}

export function assertFulfillmentTransition(from: FulfillmentStatus, to: FulfillmentStatus) {
  if (!canTransitionFulfillment(from, to)) throw new Error(`Invalid fulfillment transition: ${from} -> ${to}`);
}

export function canStartFulfillment(input: { paymentStatus: string; fulfillmentStatus: FulfillmentStatus }) {
  return input.paymentStatus === "PAID" && input.fulfillmentStatus === "NOT_STARTED";
}
