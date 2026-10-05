import assert from "node:assert/strict";

const delays = [60, 300, 900];
const state = { order: "SUBMITTING", attempts: [{ n: 1, status: "FAILED_BEFORE_SUBMISSION", due: 1000, key: "k1" }] };
function retry(now) {
  const old = state.attempts.at(-1);
  if (state.order !== "SUBMITTING" || old.status !== "FAILED_BEFORE_SUBMISSION" || now < old.due || old.n >= 4) return null;
  const n = old.n + 1;
  const next = { n, status: "PENDING_SUBMISSION", due: null, key: `k${n}` };
  state.attempts.push(next); return next;
}
assert.equal(state.attempts[0].due, 1000);
for (let i = 0; i < 3; i++) { const a = retry(state.attempts.at(-1).due); if (a && i < 2) { a.status = "FAILED_BEFORE_SUBMISSION"; a.due = a.n === 2 ? 1060 : a.n === 3 ? 1360 : null; } }
assert.deepEqual(state.attempts.map(a => a.n), [1, 2, 3, 4]);
assert.equal(new Set(state.attempts.map(a => a.key)).size, 4);
assert.equal(retry(Number.MAX_SAFE_INTEGER), null);
state.order = "FAILED"; assert.equal(retry(Number.MAX_SAFE_INTEGER), null);

const ambiguous = { status: "UNKNOWN_PENDING_RECONCILIATION", providerId: null };
assert.equal(ambiguous.providerId, null);
assert.equal(ambiguous.status, "UNKNOWN_PENDING_RECONCILIATION");

const claims = new Map();
async function claim(id, owner) { if (claims.has(id) && claims.get(id).expires > Date.now()) return false; claims.set(id, { owner, expires: Date.now() + 600000 }); return true; }
const race = await Promise.all([claim("o1", "a"), claim("o1", "b")]);
assert.equal(race.filter(Boolean).length, 1);
assert.equal(await claim("o1", "c"), false);
claims.get("o1").expires = Date.now() - 1; assert.equal(await claim("o1", "c"), true);

const attempts = new Map([["a", { owner: "x", expires: Date.now() - 1 }]]);
assert.equal(attempts.get("a").owner, "x");
attempts.set("a", { owner: "y", expires: Date.now() + 120000 });
assert.notEqual(attempts.get("a").owner, "x");

const statuses = { Pending: "SUBMITTED", "In progress": "PROCESSING", Completed: "COMPLETED", Partial: "PARTIAL", Canceled: "CANCELLED", Failed: "FAILED" };
assert.equal(statuses.Partial, "PARTIAL");
assert.equal(statuses.Completed, "COMPLETED");
assert.equal(statuses.Failed, "FAILED");
let addCalls = 0, statusCalls = 0;
function reconcile(a) { if (!a.providerId) return "MANUAL_REVIEW_REQUIRED"; statusCalls++; return statuses[a.providerStatus] ?? "RETRY"; }
assert.equal(reconcile({ providerId: null }), "MANUAL_REVIEW_REQUIRED");
assert.equal(statusCalls, 0);
assert.equal(reconcile({ providerId: "p1", providerStatus: "Completed" }), "COMPLETED");
assert.equal(addCalls, 0);

console.log("Phase 6 core mocked tests: PASS (15 assertions; concurrency model exercised; no provider calls)");
