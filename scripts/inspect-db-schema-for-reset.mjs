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

async function inspect() {
  console.log("=== INSPECTING DATABASE TABLES FOR RESET PLAN ===\n");

  const tablesToCheck = [
    // Operational / Test activity tables (candidates for reset)
    "orders",
    "payments",
    "wallet_transactions",
    "wallets",
    "provider_orders",
    "provider_order_events",
    "fulfillment_order_claims",
    "admin_action_log",
    "pricing_audit_log",
    "rate_limit_buckets",

    // Profiles / Users
    "profiles",

    // Configuration / Catalog tables (MUST BE PRESERVED)
    "platforms",
    "services",
    "service_input_fields",
    "service_provider_input_mappings",
    "provider_catalog_services",
    "provider_health",
  ];

  const results = [];
  for (const table of tablesToCheck) {
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
    results.push({
      table,
      rows: error ? `Error: ${error.message}` : count,
      category: [
        "platforms",
        "services",
        "service_input_fields",
        "service_provider_input_mappings",
        "provider_catalog_services",
        "provider_health",
      ].includes(table)
        ? "PRESERVE (Catalog/Config)"
        : table === "profiles"
          ? "USER PROFILES"
          : "TEST ACTIVITY (To Reset)",
    });
  }

  console.table(results);

  // Check existing wallet balances
  const { data: nonZeroWallets, error: wErr } = await db
    .from("wallets")
    .select("id,user_id,currency,balance_minor,created_at")
    .neq("balance_minor", 0);

  console.log("\nWallets with non-zero balance:", nonZeroWallets?.length ?? 0);
  if (nonZeroWallets && nonZeroWallets.length > 0) {
    console.table(nonZeroWallets);
  }

  // Check admin users / roles in profiles
  const { data: adminProfiles } = await db
    .from("profiles")
    .select("id,email,role,created_at");

  console.log("\nAll registered profiles:", adminProfiles?.length ?? 0);
  if (adminProfiles) {
    console.table(adminProfiles);
  }
}

inspect().catch(console.error);
