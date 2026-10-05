import "server-only";

import type { ProviderAdapter, ProviderAccount, ProviderFulfillmentStatus, ProviderOrderRequest, ProviderOrderResult } from "../provider";
import { ReliableSMMReadOnlyClient } from "./client";

function status(value: string): ProviderFulfillmentStatus {
  const normalized = value.toLowerCase();
  const mapped: Record<string, ProviderFulfillmentStatus> = { pending: "SUBMITTED", "in progress": "PROCESSING", processing: "PROCESSING", completed: "COMPLETED", partial: "PARTIAL", canceled: "CANCELLED", cancelled: "CANCELLED", failed: "FAILED" };
  const result = mapped[normalized]; if (!result) throw new Error("Unknown ReliableSMM order status requires reconciliation."); return result;
}

export class ReliableSMMAdapter implements ProviderAdapter {
  readonly name = "reliablesmm";
  private readonly client: ReliableSMMReadOnlyClient;
  constructor(client = new ReliableSMMReadOnlyClient()) { this.client = client; }
  async acquireRequestGate() { await this.client.acquireRequestGate(); }
  async getBalance(): Promise<ProviderAccount> { return this.client.getBalance(); }
  async createOrder(input: ProviderOrderRequest, gateAcquired = false): Promise<ProviderOrderResult> {
    const result = await this.client.createOrder({ service: Number(input.providerServiceId), link: input.targetValue, quantity: input.quantity }, gateAcquired);
    return { providerOrderId: String(result.order), status: "SUBMITTED", charge: null, currency: "USD", startCount: null, remains: null, rawResponse: result };
  }
  async getOrder(providerOrderId: string): Promise<ProviderOrderResult> {
    const result = await this.client.getStatus(providerOrderId);
    return { providerOrderId, status: status(result.status), charge: String(result.charge ?? ""), currency: String(result.currency ?? "USD"), startCount: result.start_count == null ? null : Number(result.start_count), remains: result.remains == null ? null : Number(result.remains), rawResponse: result };
  }
  async cancelOrder(): Promise<void> { throw new Error("ReliableSMM cancellation is not enabled in this phase."); }
}
