/**
 * lib/orders/events.ts
 *
 * Persisted Order Event Logger.
 * Guarantees that every lifecycle event is recorded in public.order_events.
 *
 * Invariant: Non-blocking write. If logging fails, the order flow must never crash.
 */
import "server-only";
import { createSupabaseAdminClient } from "../supabase/server";

export type OrderEventType =
  | "created"
  | "payment_pending"
  | "payment_confirmed"
  | "submitted_to_provider"
  | "provider_accepted"
  | "in_progress"
  | "partial"
  | "completed"
  | "failed"
  | "retry_started"
  | "retry_succeeded"
  | "refunded"
  | "status_synced"
  | "admin_note";

export type RecordOrderEventParams = {
  orderId: string;
  type: OrderEventType | string;
  statusBefore?: string | null;
  statusAfter?: string | null;
  message?: string | null;
  meta?: Record<string, unknown> | null;
  actor?: string | null; // "system" | "webhook" | "admin:<id>" | "user:<id>"
  createdAt?: string | null;
};

/**
 * Persists an order event row into public.order_events.
 * Best-effort / non-blocking: catches and logs errors without throwing.
 */
export async function recordOrderEvent(params: RecordOrderEventParams): Promise<boolean> {
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("order_events").insert({
      order_id: params.orderId,
      type: params.type,
      status_before: params.statusBefore ?? null,
      status_after: params.statusAfter ?? null,
      message: params.message ?? null,
      meta: params.meta ?? {},
      actor: params.actor ?? "system",
      ...(params.createdAt ? { created_at: params.createdAt } : {}),
    });

    if (error) {
      console.warn(`[recordOrderEvent] Failed to persist event '${params.type}' for order ${params.orderId}:`, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[recordOrderEvent] Exception logging event '${params.type}' for order ${params.orderId}:`, err);
    return false;
  }
}
