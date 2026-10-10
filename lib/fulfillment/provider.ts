import "server-only";

export type ProviderFulfillmentStatus = "SUBMITTED" | "PROCESSING" | "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";
export type ProviderAttemptStatus = "NOT_ATTEMPTED" | "PENDING_SUBMISSION" | "SUBMITTED" | "FAILED_BEFORE_SUBMISSION" | "UNKNOWN_PENDING_RECONCILIATION";

export type ProviderOrderRequest = {
  providerServiceId: string;
  targetValue: string;
  quantity: number;
  providerParams?: Record<string, unknown>;
};

export type ProviderOrderResult = {
  providerOrderId: string;
  status: ProviderFulfillmentStatus;
  charge: string | null;
  currency: string | null;
  startCount: number | null;
  remains: number | null;
  rawResponse: unknown;
};

export type ProviderAccount = { balance: string; currency: string };

export interface ProviderAdapter {
  readonly name: string;
  createOrder(input: ProviderOrderRequest): Promise<ProviderOrderResult>;
  getOrder(providerOrderId: string): Promise<ProviderOrderResult>;
  cancelOrder(providerOrderId: string): Promise<void>;
  refillOrder?(providerOrderId: string): Promise<void>;
  getBalance(): Promise<ProviderAccount>;
}

// Provider selection and credentials are intentionally absent until a real adapter is approved.
