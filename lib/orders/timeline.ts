export type OrderTimelineEvent = {
  id: string;
  label: string;
  detail: string | null;
  occurredAt: string;
  kind: "created" | "payment" | "fulfillment" | "refund" | "review";
};

type PaymentAttempt = {
  id: string;
  provider: string;
  status: string;
  created_at: string;
  paid_at: string | null;
  updated_at: string;
};

type WalletTransaction = {
  id: string;
  type: string;
  direction: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type ProviderAttempt = {
  id: string;
  attempt_number: number;
  attempt_status: string;
  request_started_at: string | null;
  response_received_at: string | null;
  created_at: string;
};

type ProviderEvent = {
  id: string;
  provider_order_id: string | null;
  event_type: string;
  provider_status: string | null;
  metadata: unknown;
  created_at: string;
};

export function formatOrderTimelineStatus(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function buildOrderTimeline(input: {
  orderId: string;
  createdAt: string;
  payments: PaymentAttempt[];
  walletTransactions: WalletTransaction[];
  providerAttempts: ProviderAttempt[];
  providerEvents: ProviderEvent[];
}): OrderTimelineEvent[] {
  const events: OrderTimelineEvent[] = [{
    id: `order-created:${input.orderId}`,
    label: "Order created",
    detail: null,
    occurredAt: input.createdAt,
    kind: "created",
  }];

  for (const payment of input.payments) {
    const provider = payment.provider === "paystack"
      ? "Paystack"
      : formatOrderTimelineStatus(payment.provider);
    events.push({
      id: `payment-started:${payment.id}`,
      label: "Payment attempt started",
      detail: `via ${provider}`,
      occurredAt: payment.created_at,
      kind: "payment",
    });

    if (payment.status === "PAID") {
      events.push({
        id: `payment-paid:${payment.id}`,
        label: "Payment confirmed",
        detail: `via ${provider}`,
        occurredAt: payment.paid_at ?? payment.updated_at,
        kind: "payment",
      });
    } else if (["FAILED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(payment.status)) {
      const refund = payment.status !== "FAILED";
      events.push({
        id: `payment-terminal:${payment.id}`,
        label: refund
          ? payment.status === "REFUNDED" ? "Payment refunded" : "Payment partially refunded"
          : "Payment attempt failed",
        detail: null,
        occurredAt: payment.updated_at,
        kind: refund ? "refund" : "payment",
      });
    }
  }

  for (const transaction of input.walletTransactions) {
    if (transaction.type === "ORDER_DEBIT" && transaction.status === "COMPLETED") {
      events.push({
        id: `wallet-payment:${transaction.id}`,
        label: "Paid with VANTA Wallet",
        detail: null,
        occurredAt: transaction.created_at,
        kind: "payment",
      });
    } else if (transaction.type === "REFUND") {
      events.push({
        id: `wallet-refund:${transaction.id}`,
        label: transaction.status === "COMPLETED" ? "Wallet refund completed" : `Wallet refund ${formatOrderTimelineStatus(transaction.status).toLowerCase()}`,
        detail: null,
        occurredAt: transaction.status === "COMPLETED" ? transaction.created_at : transaction.updated_at,
        kind: "refund",
      });
    }
  }

  const uniqueProviderEvents = new Map(input.providerEvents.map((event) => [event.id, event]));
  const providerEvents = [...uniqueProviderEvents.values()].sort((left, right) =>
    new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  );
  const eventsByAttempt = new Map<string, ProviderEvent[]>();
  const lastProviderStatusByAttempt = new Map<string, string>();
  for (const event of providerEvents) {
    if (event.provider_order_id) {
      const attemptEvents = eventsByAttempt.get(event.provider_order_id) ?? [];
      attemptEvents.push(event);
      eventsByAttempt.set(event.provider_order_id, attemptEvents);
    }

    const metadata = record(event.metadata);
    let label: string | null = null;
    let detail: string | null = null;
    let kind: OrderTimelineEvent["kind"] = "fulfillment";

    switch (event.event_type) {
      case "CUSTOMER_FULFILLMENT_TRANSITION": {
        const from = metadata?.from;
        const to = metadata?.to;
        if (typeof to === "string") {
          label = "Fulfillment status changed";
          if (typeof from === "string") {
            detail = `${formatOrderTimelineStatus(from)} → ${formatOrderTimelineStatus(to)}`;
          }
        }
        break;
      }
      case "PROVIDER_ACCEPTED":
        label = "Provider accepted order";
        break;
      case "PROVIDER_REJECTED":
        label = "Provider could not accept the order";
        break;
      case "SUBMISSION_AMBIGUOUS":
        label = "Provider response is being confirmed";
        break;
      case "RETRY_EXHAUSTED":
        label = "Provider submission attempts exhausted";
        break;
      case "MANUAL_REVIEW_REQUIRED":
        label = "Order flagged for manual review";
        kind = "review";
        break;
      case "MANUAL_REVIEW_RESOLVED":
        label = "Manual review completed";
        kind = "review";
        break;
      case "PROVIDER_STATUS_OBSERVED":
        if (event.provider_order_id && event.provider_status) {
          const previousStatus = lastProviderStatusByAttempt.get(event.provider_order_id);
          lastProviderStatusByAttempt.set(event.provider_order_id, event.provider_status);
          if (previousStatus !== event.provider_status) {
            label = `Provider update: ${formatOrderTimelineStatus(event.provider_status)}`;
          }
        }
        break;
    }

    if (label) {
      events.push({
        id: `provider-event:${event.id}`,
        label,
        detail,
        occurredAt: event.created_at,
        kind,
      });
    }
  }

  for (const attempt of input.providerAttempts) {
    const attemptEvents = eventsByAttempt.get(attempt.id) ?? [];
    if (attemptEvents.some((event) => event.event_type === "SUBMISSION_STARTED")) continue;
    const submittedAt = attempt.request_started_at ?? attempt.created_at;
    events.push({
      id: `provider-submission:${attempt.id}`,
      label: "Fulfillment submission started",
      detail: attempt.attempt_number > 1 ? `Attempt ${attempt.attempt_number}` : null,
      occurredAt: submittedAt,
      kind: "fulfillment",
    });

    if (
      attempt.attempt_status === "SUBMITTED"
      && attempt.response_received_at
      && !attemptEvents.some((event) => event.event_type === "PROVIDER_ACCEPTED")
    ) {
      events.push({
        id: `provider-accepted:${attempt.id}`,
        label: "Provider accepted order",
        detail: attempt.attempt_number > 1 ? `Attempt ${attempt.attempt_number}` : null,
        occurredAt: attempt.response_received_at,
        kind: "fulfillment",
      });
    }
  }

  return events.sort((left, right) => {
    const timeOrder = new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime();
    return timeOrder || left.id.localeCompare(right.id);
  });
}
