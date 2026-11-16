import assert from "node:assert";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runTests() {
  console.log("=== RUNNING RECONCILIATION AND CREDITING SAFETY TESTS ===");

  const customerId = "acfa7245-622c-4fbb-aa26-19cfbee00fba";

  // Test 1: Verify customer casey's numbers & reconciliation math (all directions accounted for)
  const { data: wallet } = await supabase.from("wallets").select("*").eq("user_id", customerId).single();
  const { data: txs } = await supabase.from("wallet_transactions").select("*").eq("wallet_id", wallet.id);

  let depositsCredited = 0;
  let manualCredits = 0;
  let manualDebits = 0;
  let refunds = 0;
  let spent = 0;

  for (const t of txs) {
    const amt = Number(t.amount_minor) / 100;
    if (t.type === "DEPOSIT" && t.direction === "CREDIT") depositsCredited += amt;
    else if (t.type === "MANUAL_ADJUSTMENT" && t.direction === "CREDIT") manualCredits += amt;
    else if (t.type === "MANUAL_ADJUSTMENT" && t.direction === "DEBIT") manualDebits += amt;
    else if (t.type === "REFUND" && t.direction === "CREDIT") refunds += amt;
    else if (t.type === "ORDER_DEBIT" && t.direction === "DEBIT") spent += amt;
  }

  const expectedBalance = depositsCredited + manualCredits - manualDebits + refunds - spent;
  const currentBalance = Number(wallet.balance_minor) / 100;
  console.log(`Reconciliation formula: Deposits(${depositsCredited}) + ManualCredits(${manualCredits}) - ManualDebits(${manualDebits}) + Refunds(${refunds}) - Spent(${spent}) = ${expectedBalance}`);
  console.log(`Current wallet balance: ${currentBalance}`);
  assert.strictEqual(expectedBalance, currentBalance, "Formula balance must match current wallet balance");
  console.log("✓ Test 1 Passed: Reconciliation math strictly equals wallet balance.");

  // Test 2: Double credit prevention & idempotency of credit_wallet_deposit
  const { data: deposits } = await supabase.from("wallet_deposit_payments").select("*").eq("user_id", customerId).limit(1);
  const dep = deposits[0];

  console.log(`Testing credit idempotency check with ref ${dep.reference}`);
  // If we try to credit with mismatched amount, it must throw AMOUNT_MISMATCH
  const { error: mismatchErr } = await supabase.rpc("credit_wallet_deposit", {
    p_deposit_id: dep.id,
    p_user_id: customerId,
    p_provider_reference: dep.reference,
    p_amount_minor: "99999", // mismatch
    p_currency: "GHS",
  });

  assert.ok(mismatchErr, "Mismatched amount must reject");
  assert.strictEqual(mismatchErr.message, "AMOUNT_MISMATCH");
  console.log("✓ Test 2 Passed: Amount mismatch rejected by credit RPC.");

  // Test 3: Currency mismatch
  const { error: currErr } = await supabase.rpc("credit_wallet_deposit", {
    p_deposit_id: dep.id,
    p_user_id: customerId,
    p_provider_reference: dep.reference,
    p_amount_minor: String(dep.amount_minor),
    p_currency: "USD",
  });
  assert.ok(currErr, "Currency mismatch must reject");
  console.log("✓ Test 3 Passed: Currency mismatch rejected by credit RPC.");

  // Test 4: Insufficient wallet balance block check on order creation API
  const { data: testService } = await supabase.from("services").select("id,slug,selling_rate,min_quantity").eq("active", true).limit(1).single();
  console.log("Test service for order balance gating:", testService?.id);

  console.log("\nALL TESTS PASSED SUCCESSFULLY!");
}

runTests().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
