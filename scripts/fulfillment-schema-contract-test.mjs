import assert from "node:assert/strict";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = fs.readFileSync(".env.local", "utf8");
const getEnv = (k) => {
  const m = env.match(new RegExp(`^${k}=["']?([^"'\r\n]+)["']?`, "m"));
  return m ? m[1].trim() : process.env[k];
};

const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

assert.ok(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL must be defined in .env.local");
assert.ok(serviceKey, "SUPABASE_SERVICE_ROLE_KEY must be defined in .env.local");

const db = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function runSchemaContractTests() {
  console.log("=== RUNNING LIVE DATABASE SCHEMA-CONTRACT TESTS (READ-ONLY) ===\n");
  let passedCount = 0;

  // -------------------------------------------------------------
  // 1. dispatch-paid-order.ts: orders join services
  // -------------------------------------------------------------
  {
    console.log("[1/9] Testing dispatch-paid-order: orders !inner(services)...");
    const { data, error } = await db
      .from("orders")
      .select("id,public_order_id,total,service_id,payment_status,fulfillment_status,target_type,target_value,quantity,input_schema_version,input_schema_snapshot,input_values,services!inner(id,slug,provider,provider_service_id)")
      .limit(1);

    if (error) throw new Error(`Query 1 failed: ${error.message} (code: ${error.code})`);
    console.log("  ✓ Succeeded. Returned rows:", data?.length ?? 0);
    passedCount++;
  }

  // -------------------------------------------------------------
  // 2. dispatch-paid-order.ts: service_provider_input_mappings FK join
  // -------------------------------------------------------------
  {
    console.log("[2/9] Testing dispatch-paid-order: service_provider_input_mappings join service_input_fields...");
    const { data, error } = await db
      .from("service_provider_input_mappings")
      .select("service_id,provider,provider_service_id,provider_parameter_key,transform_id,transform_version,provider_required,omit_when_blank,schema_version,active,service_input_fields!service_provider_input_mappings_service_field_fk(key)")
      .limit(1);

    if (error) throw new Error(`Query 2 failed: ${error.message} (code: ${error.code})`);
    console.log("  ✓ Succeeded. Returned rows:", data?.length ?? 0);
    passedCount++;
  }

  // -------------------------------------------------------------
  // 3. dispatch-paid-order.ts: persistAttemptFailureState provider_orders query
  // -------------------------------------------------------------
  {
    console.log("[3/9] Testing dispatch-paid-order: provider_orders check in persistAttemptFailureState...");
    const { data, error } = await db
      .from("provider_orders")
      .select("id,attempt_status,provider_order_id")
      .limit(1);

    if (error) throw new Error(`Query 3 failed: ${error.message} (code: ${error.code})`);
    console.log("  ✓ Succeeded. Returned rows:", data?.length ?? 0);
    passedCount++;
  }

  // -------------------------------------------------------------
  // 4. sweep route: stuck orders query & fulfillment_order_claims
  // -------------------------------------------------------------
  {
    console.log("[4/9] Testing sweep route: orders stuck query & fulfillment_order_claims...");
    const { data: stuckOrders, error: stuckErr } = await db
      .from("orders")
      .select("id,public_order_id,fulfillment_status,created_at")
      .eq("payment_status", "PAID")
      .in("fulfillment_status", ["NOT_STARTED", "SUBMITTING"])
      .limit(5);

    if (stuckErr) throw new Error(`Query 4a failed: ${stuckErr.message} (code: ${stuckErr.code})`);

    const { data: claim, error: claimErr } = await db
      .from("fulfillment_order_claims")
      .select("order_id,expires_at,released_at")
      .limit(1);

    if (claimErr) throw new Error(`Query 4b failed: ${claimErr.message} (code: ${claimErr.code})`);
    console.log("  ✓ Succeeded. Stuck orders found:", stuckOrders?.length ?? 0, "| Claims checked:", claim?.length ?? 0);
    passedCount++;
  }

  // -------------------------------------------------------------
  // 5. sweep route: due provider_orders polling query
  // -------------------------------------------------------------
  {
    console.log("[5/9] Testing sweep route: provider_orders due polling query...");
    const { data, error } = await db
      .from("provider_orders")
      .select("id,status,attempt_status")
      .eq("provider", "reliablesmm")
      .not("provider_order_id", "is", null)
      .in("attempt_status", ["SUBMITTED", "UNKNOWN_PENDING_RECONCILIATION"])
      .eq("manual_review_state", "NONE")
      .limit(1);

    if (error) throw new Error(`Query 5 failed: ${error.message} (code: ${error.code})`);
    console.log("  ✓ Succeeded. Returned rows:", data?.length ?? 0);
    passedCount++;
  }

  // -------------------------------------------------------------
  // 6. cron route: batch orders & batch service_provider_input_mappings
  // -------------------------------------------------------------
  {
    console.log("[6/9] Testing cron route: batch orders join services & batch mappings...");
    const { data: batchOrders, error: ordErr } = await db
      .from("orders")
      .select("id,target_type,target_value,quantity,total,service_id,payment_status,fulfillment_status,input_schema_version,input_schema_snapshot,input_values,services!inner(id,slug,provider,provider_service_id)")
      .eq("payment_status", "PAID")
      .in("fulfillment_status", ["NOT_STARTED", "SUBMITTING"])
      .limit(5);

    if (ordErr) throw new Error(`Query 6a failed: ${ordErr.message} (code: ${ordErr.code})`);

    const { data: batchMappings, error: mapErr } = await db
      .from("service_provider_input_mappings")
      .select("service_id,provider,provider_service_id,provider_parameter_key,transform_id,transform_version,provider_required,omit_when_blank,schema_version,active,service_input_fields!service_provider_input_mappings_service_field_fk(key)")
      .limit(5);

    if (mapErr) throw new Error(`Query 6b failed: ${mapErr.message} (code: ${mapErr.code})`);
    console.log("  ✓ Succeeded. Batch orders:", batchOrders?.length ?? 0, "| Batch mappings:", batchMappings?.length ?? 0);
    passedCount++;
  }

  // -------------------------------------------------------------
  // 7. status route: orders & provider_orders attempt check
  // -------------------------------------------------------------
  {
    console.log("[7/9] Testing status route: orders & provider_orders attempt check...");
    const { data: ord, error: ordErr } = await db
      .from("orders")
      .select("id,quantity,payment_status,fulfillment_status,updated_at")
      .limit(1);

    if (ordErr) throw new Error(`Query 7a failed: ${ordErr.message} (code: ${ordErr.code})`);

    const { data: att, error: attErr } = await db
      .from("provider_orders")
      .select("id,provider,provider_order_id,status,attempt_status,manual_review_state,next_poll_at")
      .limit(1);

    if (attErr) throw new Error(`Query 7b failed: ${attErr.message} (code: ${attErr.code})`);
    console.log("  ✓ Succeeded. Orders checked:", ord?.length ?? 0, "| Attempts checked:", att?.length ?? 0);
    passedCount++;
  }

  // -------------------------------------------------------------
  // 8. status route: customer_provider_order_status view
  // -------------------------------------------------------------
  {
    console.log("[8/9] Testing status route & order page: customer_provider_order_status view query...");
    const { data, error } = await db
      .from("customer_provider_order_status")
      .select("status,start_count,remains,updated_at")
      .limit(1);

    if (error) throw new Error(`Query 8 failed: ${error.message} (code: ${error.code})`);
    console.log("  ✓ Succeeded. Returned rows:", data?.length ?? 0);
    passedCount++;
  }

  // -------------------------------------------------------------
  // 9. admin fulfillment page: counts & orders join profiles, services, provider_order_events
  // -------------------------------------------------------------
  {
    console.log("[9/9] Testing admin fulfillment page: counts & orders join profiles, services, provider_order_events...");
    const [p1, p2, p3, p4, p5, stuck] = await Promise.all([
      db.from("provider_orders").select("id", { count: "exact", head: true }).in("status", ["NOT_STARTED", "SUBMITTING"]),
      db.from("provider_orders").select("id", { count: "exact", head: true }).in("status", ["SUBMITTED", "PROCESSING"]),
      db.from("provider_orders").select("id", { count: "exact", head: true }).eq("attempt_status", "UNKNOWN_PENDING_RECONCILIATION"),
      db.from("provider_orders").select("id", { count: "exact", head: true }).eq("status", "FAILED"),
      db.from("provider_orders").select("id", { count: "exact", head: true }).eq("status", "COMPLETED"),
      db.from("orders")
        .select("id,public_order_id,total,currency,payment_status,fulfillment_status,created_at,profiles(email),services(name,slug),provider_order_events(event_type,error_code,created_at)")
        .limit(5),
    ]);

    if (p1.error) throw new Error(`Query 9 count p1 failed: ${p1.error.message}`);
    if (p2.error) throw new Error(`Query 9 count p2 failed: ${p2.error.message}`);
    if (p3.error) throw new Error(`Query 9 count p3 failed: ${p3.error.message}`);
    if (p4.error) throw new Error(`Query 9 count p4 failed: ${p4.error.message}`);
    if (p5.error) throw new Error(`Query 9 count p5 failed: ${p5.error.message}`);
    if (stuck.error) throw new Error(`Query 9 stuck orders join failed: ${stuck.error.message}`);

    console.log("  ✓ Succeeded. All 5 counts succeeded, and admin stuck orders joined profiles, services, and provider_order_events cleanly.");
    passedCount++;
  }

  console.log(`\nALL ${passedCount}/9 SCHEMA-CONTRACT QUERIES PASSED WITH ZERO ERRORS AGAINST REAL SUPABASE!`);
}

runSchemaContractTests().catch((err) => {
  console.error("\nSCHEMA CONTRACT TEST FAILED:", err);
  process.exit(1);
});
