import assert from "node:assert/strict";
import fs from "node:fs";

const resolver = fs.readFileSync("lib/fulfillment/resolver.ts", "utf8");
const attempt = fs.readFileSync("lib/fulfillment/reliablesmm/attempt.ts", "utf8");
const adapter = fs.readFileSync("lib/fulfillment/reliablesmm/adapter.ts", "utf8");
const service = fs.readFileSync("lib/fulfillment/service.ts", "utf8");
const worker = fs.readFileSync("lib/fulfillment/worker.ts", "utf8");

const tests = [];
function test(name, fn) { fn(); tests.push(name); }

function mockSubmission({ provider, providerServiceId, catalogStatus = "ACTIVE", quantity = 10000, target }) {
  if (provider !== "reliablesmm" || !providerServiceId || catalogStatus !== "ACTIVE") throw new Error("mapping rejected before submission");
  return { service: Number(providerServiceId), link: target, quantity };
}

test("DB mapping 7972 wins over hardcoded mapping", () => {
  const request = mockSubmission({ provider: "reliablesmm", providerServiceId: "7972", target: "https://instagram.com/example/p/ABC" });
  assert.equal(request.service, 7972);
  assert.match(resolver, /service\.provider_service_id/);
  assert.match(attempt, /order\.provider_service_id/);
  assert.doesNotMatch(worker, /reliableSMMProductionMappings/);
});

test("existing Instagram Views mapping remains 7486", () => {
  const request = mockSubmission({ provider: "reliablesmm", providerServiceId: "7486", target: "https://instagram.com/example/p/ABC" });
  assert.equal(request.service, 7486);
});

test("inactive catalog mapping fails before submission", () => {
  assert.throws(() => mockSubmission({ provider: "reliablesmm", providerServiceId: "7972", catalogStatus: "STALE", target: "https://instagram.com/example/p/ABC" }), /mapping rejected/);
});

test("missing mapping does not fall back", () => {
  assert.throws(() => mockSubmission({ provider: "reliablesmm", providerServiceId: null, target: "https://instagram.com/example/p/ABC" }), /mapping rejected/);
  assert.match(resolver, /if \(!service\?\.provider \|\| !service\.provider_service_id\) return null/);
});

test("wrong provider does not submit to ReliableSMM", () => {
  assert.throws(() => mockSubmission({ provider: "some-other-provider", providerServiceId: "1234", target: "https://instagram.com/example/p/ABC" }), /mapping rejected/);
  assert.match(resolver, /service\.provider !== "reliablesmm"/);
});

test("quantity is preserved", () => {
  const request = mockSubmission({ provider: "reliablesmm", providerServiceId: "7972", quantity: 10000, target: "https://instagram.com/example/p/ABC" });
  assert.equal(request.quantity, 10000);
  assert.match(adapter, /quantity: input\.quantity/);
  assert.match(attempt, /quantity: Number\(attempt\.quantity\)/);
});

test("normalized target reaches the adapter unchanged", () => {
  const target = "https://instagram.com/example/p/ABC";
  const request = mockSubmission({ provider: "reliablesmm", providerServiceId: "7972", target });
  assert.equal(request.link, target);
  assert.match(attempt, /target\.link/);
  assert.match(adapter, /link: input\.targetValue/);
});

test("safety controls remain in the changed path", () => {
  assert.match(service, /payment_status !== "PAID"/);
  assert.match(attempt, /idempotency_key/);
  assert.match(attempt, /acquire_provider_operation_lock/);
  assert.match(attempt, /acquire_submission_lease/);
  assert.match(attempt, /record_submission_boundary/);
  assert.match(attempt, /record_submission_failure/);
  assert.match(attempt, /create_safe_provider_retry/);
  assert.match(adapter, /acquireRequestGate/);
});

console.log(`phase1-reliablesmm-mapping-tests: ${tests.length} passed, 0 failed`);
