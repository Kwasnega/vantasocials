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

async function checkReal() {
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

  console.log("=== CHECKING REAL TABLE EXISTENCE ===");
  for (const t of tables) {
    const { data, error } = await db.from(t).select("*").limit(1);
    if (error) {
      console.log(`❌ ${t}: ${error.code} - ${error.message}`);
    } else {
      console.log(`✓ ${t}: table EXISTS (returned ${data.length} rows sample)`);
    }
  }
}

checkReal().catch(console.error);
