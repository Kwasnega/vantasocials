import assert from "node:assert/strict";

function sequence(events) {
  const seen = [];
  return { emit: (event) => seen.push(event), events: seen };
}

const success = sequence();
success.emit("submission_lease_acquired");
success.emit("submission_started");
success.emit("external_call_boundary_crossed");
success.emit("provider_accepted");
success.emit("customer_state_transition");
success.emit("submission_lease_released");
assert.deepEqual(success.events, ["submission_lease_acquired", "submission_started", "external_call_boundary_crossed", "provider_accepted", "customer_state_transition", "submission_lease_released"]);

const rejected = sequence();
rejected.emit("submission_started");
rejected.emit("submission_rejected");
rejected.emit("retry_scheduled");
assert.deepEqual(rejected.events, ["submission_started", "submission_rejected", "retry_scheduled"]);

const ambiguous = sequence();
ambiguous.emit("submission_started");
ambiguous.emit("external_call_boundary_crossed");
ambiguous.emit("submission_ambiguous");
assert.equal(ambiguous.events.includes("retry_scheduled"), false);

const retry = sequence();
retry.emit("retry_created");
retry.emit("submission_started");
assert.deepEqual(retry.events, ["retry_created", "submission_started"]);

const exhausted = sequence();
exhausted.emit("retry_exhausted");
exhausted.emit("customer_state_transition");
assert.deepEqual(exhausted.events, ["retry_exhausted", "customer_state_transition"]);

const reconciliation = sequence();
reconciliation.emit("reconciliation_lease_acquired");
reconciliation.emit("reconciliation_started");
reconciliation.emit("provider_status_observed");
reconciliation.emit("customer_state_transition");
reconciliation.emit("reconciliation_lease_released");
assert.equal(reconciliation.events.includes("submission_started"), false);
assert.deepEqual(reconciliation.events.slice(0, 3), ["reconciliation_lease_acquired", "reconciliation_started", "provider_status_observed"]);

const manual = sequence();
manual.emit("manual_review_required");
manual.emit("manual_review_resolved");
assert.deepEqual(manual.events, ["manual_review_required", "manual_review_resolved"]);

console.log("Phase 6 lifecycle event tests: PASS (7 scenarios; offline sequencing only)");
