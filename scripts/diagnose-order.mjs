import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = fs.readFileSync(".env.local", "utf8");
const getEnv = (k) => {
  const m = env.match(new RegExp(`^${k}=["']?([^"'\r\n]+)["']?`, "m"));
  return m ? m[1].trim() : process.env[k];
};

const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));

async function inspect(orderId, publicOrderId) {
  console.log(`=== INSPECTING ORDER: ${publicOrderId} (${orderId}) ===`);

  // 1. orders
  const { data: order, error: oErr } = await supabase.from("orders")
    .select("id, public_order_id, user_id, status, payment_status, fulfillment_status, service_id, quantity, total, currency, created_at, target_value")
    .eq("id", orderId)
    .single();
  console.log("1. orders:", order, oErr ? `(error: ${oErr.message})` : "");

  // 2. payments
  const { data: payments, error: pErr } = await supabase.from("payments")
    .select("id, order_id, user_id, status, reference, amount, currency, channel, created_at")
    .eq("order_id", orderId);
  console.log("2. payments:", payments, pErr ? `(error: ${pErr.message})` : "");

  // 3. wallet_transactions
  const { data: walletTx, error: wErr } = await supabase.from("wallet_transactions")
    .select("id, wallet_id, type, amount_minor, currency, reference, created_at")
    .ilike("reference", `%${orderId}%`);
  console.log("3. wallet_transactions:", walletTx, wErr ? `(error: ${wErr.message})` : "");

  // 4. provider_orders
  const { data: providerOrders, error: poErr } = await supabase.from("provider_orders")
    .select("id, order_id, attempt_number, provider, provider_service_id, attempt_status, status, provider_order_id, created_at")
    .eq("order_id", orderId);
  console.log("4. provider_orders:", providerOrders, poErr ? `(error: ${poErr.message})` : "");

  // 5. provider_order_events
  const { data: providerEvents, error: peErr } = await supabase.from("provider_order_events")
    .select("id, order_id, event_name, created_at")
    .eq("order_id", orderId);
  console.log("5. provider_order_events:", providerEvents, peErr ? `(error: ${peErr.message})` : "");

  // 6. fulfillment_order_claims
  const { data: claims, error: cErr } = await supabase.from("fulfillment_order_claims")
    .select("order_id, owner_token, acquired_at, expires_at, released_at")
    .eq("order_id", orderId);
  console.log("6. fulfillment_order_claims:", claims, cErr ? `(error: ${cErr.message})` : "");

  // 7. Check service & mapping
  if (order?.service_id) {
    const { data: service } = await supabase.from("services")
      .select("id, slug, name, active, provider, provider_service_id")
      .eq("id", order.service_id)
      .single();
    console.log("7. service:", service);

    const { data: mappings } = await supabase.from("service_provider_input_mappings")
      .select("id, service_id, provider, provider_parameter_key, transform_id, active, service_input_fields!service_provider_input_mappings_service_field_fk(key)")
      .eq("service_id", order.service_id);
    console.log("8. service_provider_input_mappings:", mappings);
  }
}

inspect("c199b428-c035-4d03-a3bc-c07c7276462c", "VNT-350C1D").catch(console.error);
