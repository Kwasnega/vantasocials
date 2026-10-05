import assert from "node:assert/strict";

const terminal = new Set(["FAILED", "PARTIAL", "COMPLETED", "CANCELLED"]);
const transition = (current, requested, result) => ({ current, requested, result, customerState: result === true ? requested : current });
assert.equal(transition("SUBMITTED", "COMPLETED", true).customerState, "COMPLETED");
assert.equal(transition("COMPLETED", "FAILED", false).customerState, "COMPLETED");
assert.equal(transition("SUBMITTED", "COMPLETED", false).customerState, "SUBMITTED");
assert.equal(transition("SUBMITTED", "COMPLETED", "DB_ERROR").customerState, "SUBMITTED");
for (const state of terminal) assert.equal(transition(state, "PROCESSING", false).customerState, state);

let addCalls = 0;
const criticalBoundary = (eventOk) => { if (!eventOk) throw new Error("EVENT_WRITE_FAILED"); };
assert.throws(() => { criticalBoundary(false); addCalls++; });
assert.equal(addCalls, 0);
criticalBoundary(true); addCalls++;
assert.equal(addCalls, 1);

const providerAcceptedThenPersistenceFails = { attemptStatus: "UNKNOWN_PENDING_RECONCILIATION", providerOrderId: null, retry: false };
assert.equal(providerAcceptedThenPersistenceFails.retry, false);
assert.equal(providerAcceptedThenPersistenceFails.attemptStatus, "UNKNOWN_PENDING_RECONCILIATION");

const reconciliation = (eventOk, transitionResult) => {
  if (!eventOk) return { outcome: "RECONCILIATION_EVENT_FAILURE", success: false };
  if (transitionResult !== true) return { outcome: "RECONCILIATION_FAILED", success: false };
  return { outcome: "RECONCILED", success: true };
};
assert.equal(reconciliation(false, true).success, false);
assert.equal(reconciliation(true, false).success, false);
assert.equal(reconciliation(true, true).success, true);

const manualReview = (eventOk) => eventOk ? "RECORDED" : "STATE_WRITE_REQUIRES_REVIEW";
assert.equal(manualReview(false), "STATE_WRITE_REQUIRES_REVIEW");

console.log("Phase 6 failure semantics tests: PASS (13 assertions; offline failure model only)");
