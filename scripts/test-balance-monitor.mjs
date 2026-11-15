import assert from "node:assert/strict";

// Pure JavaScript logic for Node.js execution
function computeBalanceAlertStatus(balance, warning, critical) {
  if (balance < critical) return "CRITICAL";
  if (balance < warning) return "WARNING";
  return "OK";
}

function computeRunwayDays(currentBalance, spendLast7Days) {
  if (!spendLast7Days.length) return null;
  const totalSpend = spendLast7Days.reduce((a, b) => a + b, 0);
  if (totalSpend <= 0) return null;
  const avgDailySpend = totalSpend / 7;
  const days = currentBalance / avgDailySpend;
  return Math.max(0, Math.round(days * 10) / 10);
}

function evaluateConsecutiveFailureRule(consecutiveFailures, apiFailed) {
  if (!apiFailed) {
    return { newFailures: 0, alertStatus: null };
  }
  const newFailures = consecutiveFailures + 1;
  return {
    newFailures,
    alertStatus: newFailures >= 3 ? "CRITICAL" : "UNKNOWN",
  };
}

console.log("Running Provider Balance Monitor Unit Tests...");

// 1. Threshold logic test
console.log("- Test 1: Threshold logic (warning=10, critical=3)");
assert.equal(computeBalanceAlertStatus(15.5, 10, 3), "OK", "Balance 15.5 should be OK");
assert.equal(computeBalanceAlertStatus(10.0, 10, 3), "OK", "Balance 10.0 should be OK (boundary)");
assert.equal(computeBalanceAlertStatus(9.99, 10, 3), "WARNING", "Balance 9.99 should be WARNING");
assert.equal(computeBalanceAlertStatus(5.0, 10, 3), "WARNING", "Balance 5.0 should be WARNING");
assert.equal(computeBalanceAlertStatus(3.0, 10, 3), "WARNING", "Balance 3.0 should be WARNING (boundary)");
assert.equal(computeBalanceAlertStatus(2.99, 10, 3), "CRITICAL", "Balance 2.99 should be CRITICAL");
assert.equal(computeBalanceAlertStatus(0.0, 10, 3), "CRITICAL", "Balance 0.0 should be CRITICAL");

// 2. Three consecutive failures rule
console.log("- Test 2: Three consecutive failures rule");
let failures = 0;
let res = evaluateConsecutiveFailureRule(failures, true);
assert.equal(res.newFailures, 1);
assert.equal(res.alertStatus, "UNKNOWN", "1 failure should remain UNKNOWN");

res = evaluateConsecutiveFailureRule(res.newFailures, true);
assert.equal(res.newFailures, 2);
assert.equal(res.alertStatus, "UNKNOWN", "2 failures should remain UNKNOWN");

res = evaluateConsecutiveFailureRule(res.newFailures, true);
assert.equal(res.newFailures, 3);
assert.equal(res.alertStatus, "CRITICAL", "3 failures must force CRITICAL");

res = evaluateConsecutiveFailureRule(res.newFailures, true);
assert.equal(res.newFailures, 4);
assert.equal(res.alertStatus, "CRITICAL", "4+ failures must remain CRITICAL");

// 3. Recovery notice / logic
console.log("- Test 3: Recovery logic");
const recoveryRes = evaluateConsecutiveFailureRule(3, false);
assert.equal(recoveryRes.newFailures, 0, "Success resets failure count to 0");
const recoveredStatus = computeBalanceAlertStatus(25.0, 10, 3);
assert.equal(recoveredStatus, "OK", "Restored balance recovers status back to OK");

// 4. Runway math
console.log("- Test 4: Runway calculations");
// $14 total spent over 7 days = $2/day avg. Balance is $10 -> 5 days
assert.equal(computeRunwayDays(10, [2, 2, 2, 2, 2, 2, 2]), 5.0);
// $70 total spent over 7 days = $10/day avg. Balance is $25 -> 2.5 days
assert.equal(computeRunwayDays(25, [10, 10, 10, 10, 10, 10, 10]), 2.5);
// Zero spend or empty
assert.equal(computeRunwayDays(25, []), null);
assert.equal(computeRunwayDays(25, [0, 0, 0]), null);

// 5. De-duplication / Idempotence logic
console.log("- Test 5: Idempotency of state evaluation");
const state1 = computeBalanceAlertStatus(8.5, 10, 3);
const state2 = computeBalanceAlertStatus(8.5, 10, 3);
assert.equal(state1, state2, "Repeated evaluations at same balance produce identical status");

console.log("All Provider Balance Monitor unit tests passed successfully!");
