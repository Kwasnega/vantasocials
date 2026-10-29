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

async function main() {
  const publicOrderId = "VNT-350C1D";
  console.log(`=== ACTUAL DATABASE ROWS FOR ORDER ${publicOrderId} ===\n`);

  // 1. orders
  const { data: order } = await db
    .from("orders")
    .select("id,public_order_id,status,payment_status,fulfillment_status,total,currency,service_id,created_at,updated_at")
    .eq("public_order_id", publicOrderId)
    .single();

  console.log("1. orders row:");
  console.table([order]);

  if (!order) return;

  // 2. provider_orders
  const { data: providerOrders } = await db
    .from("provider_orders")
    .select("id,order_id,provider,attempt_number,status,attempt_status,provider_order_id,created_at")
    .eq("order_id", order.id);

  console.log("\n2. provider_orders rows:");
  if (!providerOrders || providerOrders.length === 0) {
    console.log("  (0 rows found - no provider submission was ever recorded)");
  } else {
    console.table(providerOrders);
  }

  // 3. provider_order_events
  const { data: events } = await db
    .from("provider_order_events")
    .select("id,order_id,provider_order_id,event_type,error_code,created_at")
    .eq("order_id", order.id);

  console.log("\n3. provider_order_events rows:");
  if (!events || events.length === 0) {
    console.log("  (0 rows found - previously silent failure logged no event)");
  } else {
    console.table(events);
  }

  // 4. fulfillment_order_claims
  const { data: claims } = await db
    .from("fulfillment_order_claims")
    .select("order_id,owner_token,acquired_at,expires_at,released_at")
    .eq("order_id", order.id);

  console.log("\n4. fulfillment_order_claims rows:");
  if (!claims || claims.length === 0) {
    console.log("  (0 rows found)");
  } else {
    console.table(claims);
  }
}

main().catch(console.error);
