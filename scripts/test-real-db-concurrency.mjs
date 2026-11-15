import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";

const env = fs.readFileSync(".env.local", "utf8");
const getEnv = (k) => {
  const m = env.match(new RegExp(`^${k}=["']?([^"'\r\n]+)["']?`, "m"));
  return m ? m[1].trim() : process.env[k];
};

const sb = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));

async function testRealDatabaseConcurrency() {
  console.log("=== REAL SUPABASE CONCURRENCY TEST FOR ATOMIC RETRY CLAIM ===");

  // 1. Find a test or dummy order to safely simulate on, or create a temporary row in 'orders'
  // Let's create a dedicated test order row in 'orders' with status='FAILED'
  const testOrderId = "00000000-0000-4000-a000-000000000999";
  
  // Clean up any prior test row
  await sb.from("orders").delete().eq("id", testOrderId);

  // Insert a test order strictly in FAILED status
  const testUuid = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
  const testFingerprint = "a".repeat(64);
  const { data: inserted, error: insertError } = await sb.from("orders").insert({
    id: testOrderId,
    public_order_id: "VNT-TEST-RETRY",
    user_id: "acfa7245-622c-4fbb-aa26-19cfbee00fba", // existing user from DB
    service_id: "56a6a7d9-c304-442f-a279-6b4bbf3ca2a1", // existing service
    target_type: "url",
    target_value: "https://example.com/test",
    quantity: 10,
    unit_price: 1,
    subtotal: 10,
    total: 10,
    currency: "GHS",
    status: "PENDING_PAYMENT",
    payment_status: "PAID",
    fulfillment_status: "FAILED",
    failure_reason: "provider_insufficient_funds",
    attempt_count: 1,
    input_schema_version: 1,
    input_schema_snapshot: [{ key: "url", inputType: "url", required: true }],
    input_values: { url: "https://example.com/test" },
    idempotency_key: testUuid,
    idempotency_fingerprint: testFingerprint,
    idempotency_service_slug: "test-service-slug",
  }).select().single();

  if (insertError) {
    console.error("Setup error inserting test order:", insertError);
    process.exit(1);
  }

  console.log("Setup: Created test order in DB with fulfillment_status='FAILED'");

  // Function simulating exact DB update used in retryOrderFulfillment
  async function attemptAtomicClaim(orderId, workerLabel) {
    const now = new Date().toISOString();
    const { data: acquired, error } = await sb
      .from("orders")
      .update({
        fulfillment_status: "SUBMITTING",
        attempt_count: 2,
        last_attempt_at: now,
      })
      .eq("id", orderId)
      .eq("fulfillment_status", "FAILED")
      .select("id,public_order_id")
      .maybeSingle();

    if (error) throw error;
    return { workerLabel, acquired: Boolean(acquired) };
  }

  // Fire two simultaneous requests at the exact same millisecond against the live database
  console.log("Executing two concurrent atomic claim queries simultaneously...");
  const [res1, res2] = await Promise.all([
    attemptAtomicClaim(testOrderId, "Worker A"),
    attemptAtomicClaim(testOrderId, "Worker B"),
  ]);

  console.log("Worker A result:", res1);
  console.log("Worker B result:", res2);

  const acquiredCount = (res1.acquired ? 1 : 0) + (res2.acquired ? 1 : 0);
  assert.equal(acquiredCount, 1, "CRITICAL: Exactly ONE concurrent request must claim the row, the other must be null!");
  console.log("✓ Real DB concurrency test passed: Exactly one row claimed!");

  // Verify the final row in DB is now in SUBMITTING
  const { data: finalRow } = await sb.from("orders").select("fulfillment_status,attempt_count").eq("id", testOrderId).single();
  assert.equal(finalRow.fulfillment_status, "SUBMITTING");
  assert.equal(finalRow.attempt_count, 2);
  console.log("✓ Final DB state verified: order is now SUBMITTING with attempt_count=2");

  // Clean up test order
  await sb.from("orders").delete().eq("id", testOrderId);
  console.log("Cleanup: Deleted test order row.");
  console.log("\n=== REAL DATABASE CONCURRENCY TEST PASSED SUCCESSFULLY ===");
}

testRealDatabaseConcurrency().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
