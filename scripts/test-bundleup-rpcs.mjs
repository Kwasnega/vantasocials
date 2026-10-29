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

async function run() {
  console.log("=== TESTING BUNDLEUP GATEWAY RPC CALLS ===");

  // Test calling claim_paystack_provider_reference with nulls to test existence
  const res1 = await db.rpc("claim_paystack_provider_reference", {
    p_payment_id: "00000000-0000-0000-0000-000000000000",
    p_provider_reference: "TEST",
  });
  console.log("claim_paystack_provider_reference call:", res1);

  // Test calling reserve_bundleup_gateway_payment_attempt
  const res2 = await db.rpc("reserve_bundleup_gateway_payment_attempt", {
    p_order_id: "00000000-0000-0000-0000-000000000000",
    p_expected_user_id: "00000000-0000-0000-0000-000000000000",
    p_return_url: "https://example.com",
  });
  console.log("reserve_bundleup_gateway_payment_attempt call:", res2);

  // Test calling create_bundleup_gateway_reconciliation_request
  const res3 = await db.rpc("create_bundleup_gateway_reconciliation_request", {
    p_request_id: "00000000-0000-0000-0000-000000000000",
    p_payment_id: "00000000-0000-0000-0000-000000000000",
    p_expected_user_id: "00000000-0000-0000-0000-000000000000",
    p_request_nonce: "nonce_1234567890abcdef",
    p_request_timestamp: "1700000000",
    p_request_body: "\\x7b7d",
  });
  console.log("create_bundleup_gateway_reconciliation_request call:", res3);
}

run().catch(console.error);
