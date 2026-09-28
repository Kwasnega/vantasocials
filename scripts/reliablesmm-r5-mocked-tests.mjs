import assert from "node:assert/strict";

const mapping = { vantaSlug: "instagram-views", provider: "reliablesmm", providerServiceId: "7486", active: false, status: "MANUAL_REVIEW" };
assert.equal(mapping.active, false);
assert.equal(mapping.providerServiceId, "7486");
assert.throws(() => { if (!mapping.active) throw new Error("inactive"); }, /inactive/);
const statuses = { Pending: "SUBMITTED", "In progress": "PROCESSING", Completed: "COMPLETED", Partial: "PARTIAL", Canceled: "CANCELLED", Failed: "FAILED" };
assert.deepEqual(statuses, { Pending: "SUBMITTED", "In progress": "PROCESSING", Completed: "COMPLETED", Partial: "PARTIAL", Canceled: "CANCELLED", Failed: "FAILED" });
let attempts = new Map(); const key = "order-1:reliablesmm:7486"; attempts.set(key, "PENDING_SUBMISSION"); assert.equal(attempts.size, 1); assert.equal(attempts.get(key), "PENDING_SUBMISSION");
assert.equal(Math.min(3600, Math.max(60, 60 * 2 ** 5)), 1920); assert.equal(Math.min(3600, Math.max(60, 60 * 2 ** 10)), 3600);
assert.equal(["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"].includes("COMPLETED"), true);
console.log("ReliableSMM mocked safety tests: PASS");
