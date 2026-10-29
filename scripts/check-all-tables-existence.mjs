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

async function check() {
  const tables = [
    "bundleup_gateway_payment_evidence",
    "bundleup_gateway_reconciliation_requests",
    "payment_provider_reference_claims",
    "payments",
    "wallet_deposit_payments",
    "fulfillment_order_claims",
    "provider_order_events",
    "wallet_transactions",
    "provider_orders",
    "orders",
    "wallets",
    "webhook_events",
    "pricing_audit_log",
    "rate_limit_buckets",
  ];

  for (const t of tables) {
    const { error } = await db.from(t).select("*", { count: "exact", head: true });
    if (error && error.message.includes("does not exist")) {
      console.log(`❌ Table DOES NOT EXIST: ${t}`);
    } else if (error) {
      console.log(`⚠️ Table error: ${t} - ${error.message}`);
    } else {
      console.log(`✓ Table EXISTS: ${t}`);
    }
  }
}

check().catch(console.error);
