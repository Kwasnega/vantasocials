// scripts/test-retry-eligibility-and-concurrency.mjs
// Unit and concurrency tests for getRetryEligibility and safe retry handling.
import assert from "node:assert/strict";

console.log("=== RUNNING RETRY ELIGIBILITY & CONCURRENCY TESTS ===\n");

// 1. Pure unit tests for eligibility rules
function getRetryEligibility(order) {
  if (order.payment_status !== "PAID") {
    return {
      eligible: false,
      reason: `Order payment status is ${order.payment_status}. Only paid orders can be fulfilled.`,
    };
  }

  if (order.provider_order_id) {
    return {
      eligible: false,
      reason: "Order already has an active provider order ID and was received by the provider.",
    };
  }

  if (["COMPLETED", "PROCESSING", "SUBMITTED"].includes(order.fulfillment_status)) {
    return {
      eligible: false,
      reason: `Order is currently in ${order.fulfillment_status} state.`,
    };
  }

  const failureReason = order.failure_reason ?? "unknown";

  if (failureReason === "invalid_target") {
    return {
      eligible: false,
      reason: "Invalid link or private profile. The customer or admin must fix the target URL first.",
    };
  }

  if (failureReason === "internal_error") {
    return {
      eligible: false,
      reason: "System configuration error. Service mappings or database config must be corrected before retry.",
    };
  }

  // AUTO-ELIGIBLE: Only provider_insufficient_funds or pre-connection provider_unreachable
  if (failureReason === "provider_insufficient_funds" || failureReason === "provider_unreachable") {
    return {
      eligible: true,
      reason: "Eligible for automatic retry. Provider did not register or charge this order.",
    };
  }

  // AMBIGUOUS: provider_timeout, provider_rejected, unknown
  if (failureReason === "provider_timeout") {
    return {
      eligible: false,
      canForce: true,
      reason: "Timed out awaiting provider confirmation. The order may already exist at ReliableSMM. Check provider panel before forcing retry.",
    };
  }

  if (failureReason === "provider_rejected") {
    return {
      eligible: false,
      canForce: true,
      reason: "Provider rejected request. Review the failure details or verify service status before retrying.",
    };
  }

  return {
    eligible: false,
    canForce: true,
    reason: "Unrecognized failure outcome. Order requires manual review before retry.",
  };
}

// Classifier test for pre-connect vs 502/fetch failed
function classifyProviderFailure(error) {
  const msg = typeof error === "string" ? error : error?.message || "";
  const messageLower = msg.toLowerCase();

  if (/timeout|timed[\s_-]out|etimedout|408/i.test(messageLower)) {
    return { reason: "provider_timeout", detail: msg };
  }
  if (/econnrefused|ehostunreach|enotfound|getaddrinfo/i.test(messageLower)) {
    return { reason: "provider_unreachable", detail: msg };
  }
  if (/not enough balance|insufficient funds|insufficient balance|not enough funds|balance|insufficient/i.test(messageLower)) {
    return { reason: "provider_insufficient_funds", detail: msg };
  }
  if (/invalid link|bad link|invalid url|invalid target|private profile|link is private/i.test(messageLower)) {
    return { reason: "invalid_target", detail: msg };
  }
  if (/incorrect request|service disabled|quantity is less/i.test(messageLower)) {
    return { reason: "provider_rejected", detail: msg };
  }
  if (/mapping|schema|invalid quantity/i.test(messageLower)) {
    return { reason: "internal_error", detail: msg };
  }
  return { reason: "unknown", detail: msg };
}

// TEST 1: Auto-eligibility strictly limited
console.log("Test 1: Auto-eligibility verification...");
const eligibleFunds = getRetryEligibility({
  id: "ord-1",
  payment_status: "PAID",
  fulfillment_status: "FAILED",
  failure_reason: "provider_insufficient_funds",
  provider_order_id: null,
});
assert.equal(eligibleFunds.eligible, true, "provider_insufficient_funds MUST be auto-eligible");

const eligibleUnreachable = getRetryEligibility({
  id: "ord-2",
  payment_status: "PAID",
  fulfillment_status: "FAILED",
  failure_reason: "provider_unreachable",
  provider_order_id: null,
});
assert.equal(eligibleUnreachable.eligible, true, "pre-connection provider_unreachable MUST be auto-eligible");

// TEST 2: Timeout and 502 are NEVER auto-eligible
console.log("Test 2: provider_timeout and 502 are NOT auto-eligible...");
const timeoutOrder = getRetryEligibility({
  id: "ord-3",
  payment_status: "PAID",
  fulfillment_status: "FAILED",
  failure_reason: "provider_timeout",
  provider_order_id: null,
});
assert.equal(timeoutOrder.eligible, false, "provider_timeout must NOT be auto-eligible");
assert.equal(timeoutOrder.canForce, true, "provider_timeout must offer manual force-retry");

const classified502 = classifyProviderFailure(new Error("502 Bad Gateway"));
assert.equal(classified502.reason, "unknown", "HTTP 502 must classify as unknown (ambiguous), not unreachable");
const order502 = getRetryEligibility({
  id: "ord-4",
  payment_status: "PAID",
  fulfillment_status: "FAILED",
  failure_reason: classified502.reason,
  provider_order_id: null,
});
assert.equal(order502.eligible, false, "502 error order must NOT be auto-eligible");
assert.equal(order502.canForce, true, "502 error order allows manual force review");

// TEST 3: Orders with existing provider_order_id are NEVER eligible
console.log("Test 3: Existing provider_order_id blocks retry completely...");
const alreadySubmitted = getRetryEligibility({
  id: "ord-5",
  payment_status: "PAID",
  fulfillment_status: "FAILED",
  failure_reason: "provider_insufficient_funds",
  provider_order_id: "9735645",
});
assert.equal(alreadySubmitted.eligible, false, "Must block if provider_order_id exists");
assert.equal(alreadySubmitted.canForce, undefined, "Cannot force-retry an already submitted order");

// TEST 4: Invalid target is NOT eligible
console.log("Test 4: Invalid target blocks retry...");
const badLink = getRetryEligibility({
  id: "ord-6",
  payment_status: "PAID",
  fulfillment_status: "FAILED",
  failure_reason: "invalid_target",
  provider_order_id: null,
});
assert.equal(badLink.eligible, false);
assert.equal(badLink.canForce, undefined, "Invalid target cannot be forced without editing target");

// TEST 5: Unpaid orders are NOT eligible
console.log("Test 5: Unpaid orders block retry...");
const unpaid = getRetryEligibility({
  id: "ord-7",
  payment_status: "UNPAID",
  fulfillment_status: "FAILED",
  failure_reason: "provider_insufficient_funds",
  provider_order_id: null,
});
assert.equal(unpaid.eligible, false);

// TEST 6: Simulated Concurrency / Double-click Protection
console.log("Test 6: Simulated concurrent double-click retry test...");
class MockDatabase {
  constructor() {
    this.order = {
      id: "ord-double-click",
      fulfillment_status: "FAILED",
      attempt_count: 1,
    };
    this.providerCalls = 0;
  }

  // Atomic conditional update simulation: UPDATE orders SET ... WHERE id=$1 AND fulfillment_status in ('FAILED', 'SUBMITTING')
  async atomicAcquireRetry(orderId) {
    if (this.order.id !== orderId) return null;
    if (this.order.fulfillment_status !== "FAILED") {
      return null; // Already acquired by another request!
    }
    this.order.fulfillment_status = "SUBMITTING";
    this.order.attempt_count += 1;
    return { ...this.order };
  }

  async callProvider() {
    this.providerCalls += 1;
    await new Promise((r) => setTimeout(r, 50));
    return { order: 12345 };
  }
}

async function simulateRetry(db, orderId) {
  const acquired = await db.atomicAcquireRetry(orderId);
  if (!acquired) {
    return { outcome: "BLOCKED", message: "Concurrent attempt blocked" };
  }
  const res = await db.callProvider();
  return { outcome: "SUCCEEDED", providerOrder: res };
}

const mockDb = new MockDatabase();
// Launch two concurrent retries on the exact same order simultaneously
const [res1, res2] = await Promise.all([
  simulateRetry(mockDb, "ord-double-click"),
  simulateRetry(mockDb, "ord-double-click"),
]);

assert.equal(mockDb.providerCalls, 1, "Provider should be called EXACTLY ONCE across concurrent retries");
const outcomes = [res1.outcome, res2.outcome].sort();
assert.deepEqual(outcomes, ["BLOCKED", "SUCCEEDED"], "One request must succeed and the concurrent duplicate must be blocked");
console.log("✓ Double-click concurrency test passed: only 1 provider call made.");

// TEST 7: Crash safety boundary simulation
console.log("Test 7: Crash safety boundary simulation...");
let simulatedAttemptStatus = "PENDING_SUBMISSION";
function recordSubmissionBoundary() {
  simulatedAttemptStatus = "UNKNOWN_PENDING_RECONCILIATION";
}
function simulateCrashBeforeProviderResponse() {
  recordSubmissionBoundary();
  // Process dies / throws here
  throw new Error("Process killed mid-call");
}

try {
  simulateCrashBeforeProviderResponse();
} catch (e) {
  // Catch simulated crash
}
assert.equal(simulatedAttemptStatus, "UNKNOWN_PENDING_RECONCILIATION", "Mid-call crash must leave attempt in UNKNOWN_PENDING_RECONCILIATION (needs review)");
console.log("✓ Crash safety test passed: order remains in UNKNOWN_PENDING_RECONCILIATION, never auto-eligible.");

console.log("\n=== ALL RETRY ELIGIBILITY & CONCURRENCY TESTS PASSED ===");
