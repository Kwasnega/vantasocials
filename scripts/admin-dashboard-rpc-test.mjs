import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

console.log("=== RUNNING ADMIN DASHBOARD RPC VALIDATION TEST ===");

// 1. Read .env.local to grab Supabase credentials
const envPath = path.resolve(process.cwd(), ".env.local");
assert.ok(fs.existsSync(envPath), ".env.local not found");

const envContent = fs.readFileSync(envPath, "utf-8");
function getEnv(key) {
  const match = envContent.match(new RegExp(`^${key}=["']?([^"'\r\n]+)["']?`, "m"));
  return match ? match[1].trim() : process.env[key];
}

const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

assert.ok(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is missing");
assert.ok(serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY is missing");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function run() {
  console.log("Calling get_admin_dashboard_metrics() RPC...");
  const { data: rpcData, error: rpcError } = await supabase.rpc("get_admin_dashboard_metrics");
  
  if (rpcError) {
    console.error("RPC Error:", rpcError);
    process.exit(1);
  }
  
  console.log("RPC returned:", JSON.stringify(rpcData, null, 2));

  // Run direct SQL queries using service client to compare
  console.log("Querying direct counts...");
  const [
    { count: ordersCount },
    { count: paidOrdersCount },
    { count: customersCount },
    { count: catalogCount },
  ] = await Promise.all([
    supabase.from("orders").select("*", { count: "exact", head: true }),
    supabase.from("orders").select("*", { count: "exact", head: true }).eq("payment_status", "PAID"),
    supabase.from("profiles").select("*", { count: "exact", head: true }),
    supabase.from("provider_catalog_services").select("*", { count: "exact", head: true }),
  ]);

  console.log(`Direct Counts:
  Orders: ${ordersCount} (RPC: ${rpcData.orders_count})
  Paid Orders: ${paidOrdersCount} (RPC: ${rpcData.paid_orders_count})
  Customers: ${customersCount} (RPC: ${rpcData.customers_count})
  Catalog Services: ${catalogCount} (RPC: ${rpcData.catalog_service_count})
`);

  assert.equal(rpcData.orders_count, ordersCount, "Orders count mismatch");
  assert.equal(rpcData.paid_orders_count, paidOrdersCount, "Paid orders count mismatch");
  assert.equal(rpcData.customers_count, customersCount, "Customers count mismatch");
  assert.equal(rpcData.catalog_service_count, catalogCount, "Catalog service count mismatch");

  console.log("✓ All RPC counts perfectly match direct database queries.");
  console.log("=== DASHBOARD RPC TEST PASSED ===");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
