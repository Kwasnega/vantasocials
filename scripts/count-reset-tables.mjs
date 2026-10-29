/**
 * Counts rows in tables needed for the DB reset plan.
 * Focuses on tables not yet counted in the previous inspection.
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

const tables = [
  // Previously known
  "orders",
  "payments",
  "wallet_transactions",
  "wallets",
  "provider_orders",
  "provider_order_events",
  "fulfillment_order_claims",
  "pricing_audit_log",
  "rate_limit_buckets",
  "admin_action_log",
  // Unknown from last session
  "bundleup_gateway_payment_evidence",
  "bundleup_gateway_reconciliation_requests",
  "payment_provider_reference_claims",
  "webhook_events",
  "wallet_deposit_payments",
  // Preserved tables
  "platforms",
  "services",
  "provider_catalog_services",
];

console.log("Counting rows in all relevant tables...\n");
for (const t of tables) {
  try {
    const { count, error } = await db.from(t).select("*", { count: "exact", head: true });
    if (error) {
      console.log(`  ${t}: ERROR - ${error.message}`);
    } else {
      console.log(`  ${t}: ${count}`);
    }
  } catch (e) {
    console.log(`  ${t}: EXCEPTION - ${e.message}`);
  }
}

// Check wipe RPC existence
console.log("\nChecking wipe_all_test_data RPC...");
const { data: rpcCheck, error: rpcErr } = await db.rpc("wipe_all_test_data", {
  p_confirmation: "DRY_RUN_DO_NOT_WIPE",
});
if (rpcErr) {
  // Expected — wrong confirmation phrase. Check if error is "invalid confirmation" vs "does not exist"
  if (rpcErr.message.includes("does not exist") || rpcErr.code === "42883") {
    console.log("  wipe_all_test_data: DOES NOT EXIST in DB");
  } else {
    console.log(`  wipe_all_test_data: EXISTS (got expected error: ${rpcErr.message})`);
  }
} else {
  console.log("  wipe_all_test_data: EXISTS and returned:", JSON.stringify(rpcCheck));
}

// Check pricing_audit_log schema (FK info)
console.log("\nChecking pricing_audit_log columns...");
const { data: palSample, error: palErr } = await db.from("pricing_audit_log").select("*").limit(1);
if (palErr) {
  console.log("  Error:", palErr.message);
} else if (palSample && palSample.length > 0) {
  console.log("  Columns:", Object.keys(palSample[0]).join(", "));
} else {
  console.log("  Table exists but is empty");
}

console.log("\nDone.");
process.exit(0);
