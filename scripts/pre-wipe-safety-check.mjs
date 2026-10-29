/**
 * Pre-wipe safety check - confirm no orders will block admin_wipe_order_financial_data()
 * and get exact order states.
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = fs.readFileSync(".env.local", "utf8");
const getEnv = (k) => {
  const m = env.match(new RegExp(`^${k}=["']?([^"'\r\n]+)["']?`, "m"));
  return m ? m[1].trim() : process.env[k];
};

const db = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log("=== PRE-WIPE SAFETY CHECK ===\n");

// 1. Orders that would BLOCK the wipe
const { data: blockingOrders } = await db
  .from("orders")
  .select("public_order_id, status, payment_status, fulfillment_status")
  .or("payment_status.eq.PENDING,status.eq.PROCESSING")
  .in("fulfillment_status", ["SUBMITTING", "SUBMITTED", "PROCESSING"]);

console.log("Orders that would BLOCK the wipe:", blockingOrders?.length ?? 0);
if (blockingOrders?.length) console.table(blockingOrders);

// 2. All orders - current states
const { data: allOrders } = await db
  .from("orders")
  .select("public_order_id, status, payment_status, fulfillment_status, created_at")
  .order("created_at", { ascending: false });

console.log("\nAll orders (" + (allOrders?.length ?? 0) + " total):");
console.table(allOrders);

// 3. Pending payments
const { data: pendingPayments } = await db
  .from("payments")
  .select("id, status, amount_minor, created_at")
  .eq("status", "PENDING");
console.log("Pending payments:", pendingPayments?.length ?? 0);

// 4. Active fulfillment claims
const { data: activeClaims } = await db
  .from("fulfillment_order_claims")
  .select("id, order_id, released_at, expires_at")
  .is("released_at", null)
  .gt("expires_at", new Date().toISOString());
console.log("Active (unreleased, unexpired) claims:", activeClaims?.length ?? 0);
if (activeClaims?.length) console.table(activeClaims);

// 5. Provider orders that would block
const { data: blockingProviderOrders } = await db
  .from("provider_orders")
  .select("id, attempt_status, status")
  .in("attempt_status", ["PENDING_SUBMISSION", "SUBMITTED", "UNKNOWN_PENDING_RECONCILIATION"]);
console.log("Blocking provider_orders:", blockingProviderOrders?.length ?? 0);
if (blockingProviderOrders?.length) console.table(blockingProviderOrders);

// 6. Active webhook events
const { data: activeWebhooks } = await db
  .from("webhook_events")
  .select("id, provider, processing")
  .eq("provider", "paystack")
  .eq("processing", true);
console.log("Active paystack webhook events:", activeWebhooks?.length ?? 0);

// 7. Pending wallet deposits
const { data: pendingDeposits } = await db
  .from("wallet_deposit_payments")
  .select("id, status")
  .in("status", ["PENDING", "INITIALIZING", "AUTHORIZED"]);
console.log("Pending wallet deposits:", pendingDeposits?.length ?? 0);

// 8. pricing_audit_log FK columns
const { data: pricingRows } = await db
  .from("pricing_audit_log")
  .select("id, service_id, field, changed_at")
  .limit(3);
console.log("\nprice_audit_log sample rows (no FK to orders):");
console.table(pricingRows);

console.log("\n=== VERDICT ===");
const canWipe =
  !blockingOrders?.length &&
  !pendingPayments?.length &&
  !activeClaims?.length &&
  !blockingProviderOrders?.length &&
  !activeWebhooks?.length &&
  !pendingDeposits?.length;
console.log("Safe to call admin_wipe_order_financial_data:", canWipe ? "YES ✓" : "NO — see blockers above");
process.exit(0);
