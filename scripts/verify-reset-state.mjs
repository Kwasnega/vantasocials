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

async function verify() {
  console.log("=== VANTA DATABASE STATE VERIFICATION ===\n");

  const counts = {};

  // Check test/operational tables
  const tables = [
    "orders",
    "payments",
    "wallet_transactions",
    "provider_orders",
    "provider_order_events",
    "fulfillment_order_claims",
    "wallet_deposit_payments",
    "pricing_audit_log",
    "rate_limit_buckets",
  ];

  for (const t of tables) {
    const { count, error } = await db.from(t).select("*", { count: "exact", head: true });
    counts[t] = error ? `Error: ${error.message}` : count;
  }

  // Non-zero wallets
  const { data: nonZeroWallets, error: wErr } = await db
    .from("wallets")
    .select("id,user_id,balance_minor")
    .neq("balance_minor", 0);
  counts["non_zero_wallets"] = wErr ? `Error: ${wErr.message}` : nonZeroWallets?.length ?? 0;

  // Preserved catalog tables
  const catalogTables = [
    "platforms",
    "services",
    "service_input_fields",
    "service_provider_input_mappings",
    "provider_catalog_services",
    "profiles",
  ];

  for (const t of catalogTables) {
    const { count, error } = await db.from(t).select("*", { count: "exact", head: true });
    counts[t] = error ? `Error: ${error.message}` : count;
  }

  console.table(counts);

  const isClean =
    counts.orders === 0 &&
    counts.payments === 0 &&
    counts.wallet_transactions === 0 &&
    counts.provider_orders === 0 &&
    counts.provider_order_events === 0 &&
    counts.fulfillment_order_claims === 0 &&
    counts.wallet_deposit_payments === 0 &&
    counts.pricing_audit_log === 0 &&
    counts.rate_limit_buckets === 0 &&
    counts.non_zero_wallets === 0;

  const isCatalogIntact =
    counts.platforms === 13 &&
    counts.services === 26 &&
    counts.service_input_fields === 1 &&
    counts.service_provider_input_mappings === 1 &&
    counts.provider_catalog_services === 4124 &&
    counts.profiles === 6;

  console.log("\nOperational Test Data Cleared (Target: 0):", isClean ? "YES (100% Clean) ✓" : "NO (Data Still Present)");
  console.log("Catalog & Configuration Preserved:", isCatalogIntact ? "YES (100% Intact) ✓" : "NO (Discrepancy Detected)");

  if (isClean && isCatalogIntact) {
    console.log("\n>>> DATABASE IS IN A PRISTINE STATE FOR PRODUCTION LAUNCH. <<<");
  }
}

verify().catch(console.error);
