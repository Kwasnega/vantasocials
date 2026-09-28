import "server-only";

import { createSupabaseAdminClient } from "../../supabase/server";
import { ReliableSMMAdapter } from "./adapter";

const terminal = new Set(["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"]);
const intervalSeconds = (attempts: number) => Math.min(3600, Math.max(60, 60 * 2 ** Math.min(attempts, 5)));

export async function reconcileReliableSMMBatch(limit = 10, adapter = new ReliableSMMAdapter()) {
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const { data: attempts, error } = await admin.from("provider_orders").select("id,order_id,provider_order_id,status,poll_attempts").eq("provider", "reliablesmm").not("provider_order_id", "is", null).not("status", "in", "(COMPLETED,PARTIAL,FAILED,CANCELLED)").or(`next_poll_at.is.null,next_poll_at.lte.${now}`).order("created_at", { ascending: true }).limit(Math.min(Math.max(limit, 1), 10));
  if (error) throw error;
  const results = [];
  for (const attempt of attempts || []) {
    const result = await adapter.getOrder(String(attempt.provider_order_id));
    const next = terminal.has(result.status) ? null : new Date(Date.now() + intervalSeconds(Number(attempt.poll_attempts || 0) + 1) * 1000).toISOString();
    await admin.from("provider_orders").update({ status: result.status, charge: result.charge, currency: result.currency, start_count: result.startCount, remains: result.remains, raw_response: result.rawResponse, last_polled_at: now, next_poll_at: next, poll_attempts: Number(attempt.poll_attempts || 0) + 1, attempt_status: terminal.has(result.status) ? "SUBMITTED" : "SUBMITTED" }).eq("id", attempt.id).eq("provider", "reliablesmm");
    if (result.status === "COMPLETED" || result.status === "PARTIAL" || result.status === "FAILED" || result.status === "CANCELLED") await admin.from("orders").update({ fulfillment_status: result.status }).eq("id", attempt.order_id);
    results.push({ attemptId: attempt.id, status: result.status });
  }
  return { processed: results.length, results };
}
