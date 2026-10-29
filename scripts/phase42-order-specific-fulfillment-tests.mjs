import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";

const ORDER_ID = "6de6cd32-998f-4d61-b4bc-8a6ac4eff5b6";
const PUBLIC_ORDER_ID = "VNT-610A68";
const TARGET_URL = "https://www.instagram.com/p/DZA13GGjXEP/";

function compile(source, dependencies, env = {}) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    process: { env },
    console: { info() {}, error() {} },
    URL,
    Request,
    require(specifier) {
      if (specifier in dependencies) return dependencies[specifier];
      throw new Error(`Unexpected import: ${specifier}`);
    },
  });
  return module.exports;
}

const { buildReliableSMMProviderRequest } = compile(
  fs.readFileSync("lib/fulfillment/reliablesmm/request.ts", "utf8"),
  { "./reserved-keys": { RELIABLESMM_RESERVED_TRANSPORT_KEYS: new Set(["action", "service", "quantity", "link"]) } },
);

function createRouteHarness() {
  const state = {
    user: { id: "admin-user" },
    isAdmin: { id: "admin-user" },
    order: {
      id: ORDER_ID,
      public_order_id: PUBLIC_ORDER_ID,
      service_id: "service-id",
      target_type: "url",
      target_value: "dynamic-configured-order",
      quantity: 100,
      total: 0.1,
      currency: "GHS",
      payment_status: "PAID",
      fulfillment_status: "NOT_STARTED",
      input_schema_snapshot: [{ key: "post_url", inputType: "post_url" }],
      input_values: { post_url: TARGET_URL },
      services: {
        id: "service-id",
        slug: "instagram-views",
        target_type: "url",
        provider: "reliablesmm",
        provider_service_id: "2037",
        min_quantity: 100,
        max_quantity: 100000,
        platforms: { slug: "instagram" },
      },
    },
    catalog: { provider_status: "ACTIVE", provider_currency: "USD", rate_unit: "PER_1000", min_quantity: 100, max_quantity: 2147483647 },
    mappings: [{
      provider: "reliablesmm",
      provider_service_id: "2037",
      provider_parameter_key: "link",
      transform_id: "normalize_url",
      transform_version: 1,
      active: true,
      service_input_fields: { key: "post_url", input_type: "post_url" },
    }],
    attempts: [],
    claimResult: true,
    workerError: null,
    adminLookupCount: 0,
    calls: { claim: 0, release: 0, worker: [], transitions: [] },
    logs: [],
  };
  const adminClient = {
    from(table) {
      const filters = {};
      const builder = {
        select() { return this; },
        eq(key, value) { filters[key] = value; return this; },
        async maybeSingle() {
          if (table === "orders") {
            state.adminLookupCount++;
            return state.order && filters.id === ORDER_ID && filters.public_order_id === PUBLIC_ORDER_ID
              ? { data: state.order, error: null }
              : { data: null, error: null };
          }
          if (table === "provider_catalog_services") return { data: state.catalog, error: null };
          throw new Error(`Unexpected maybeSingle table: ${table}`);
        },
        async then(resolve, reject) {
          if (table === "service_provider_input_mappings") return resolve({ data: state.mappings, error: null });
          if (table === "provider_orders") return resolve({ data: state.attempts, error: null });
          return reject(new Error(`Unexpected table query: ${table}`));
        },
      };
      return builder;
    },
    async rpc(name, args) {
      state.calls.transitions.push({ name, args });
      return { data: true, error: null };
    },
  };

  const env = {
    PANELS_LIVE_FULFILLMENT_ENABLED: "true",
    R4_TEST_MODE: "false",
    RELIABLESMM_API_KEY: "mock-provider-key",
  };
  const logs = state.logs;
  const route = compile(
    fs.readFileSync("app/api/admin/fulfillment/canary-vnt-610a68/route.ts", "utf8"),
    {
      "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200, headers: init.headers }) } },
      "node:crypto": crypto,
      "../../../../../lib/admin/auth": { requireAdmin: async () => ({ user: state.user, admin: state.isAdmin }) },
      "../../../../../lib/security/rate-limit": {
        enforceAdminRateLimit: async () => null,
        limiterUnavailable: () => ({ status: 503 }),
      },
      "../../../../../lib/supabase/server": { createSupabaseAdminClient: () => adminClient },
      "../../../../../lib/fulfillment/claims": {
        claimOrder: async () => { state.calls.claim++; return state.claimResult; },
        releaseOrderClaim: async () => { state.calls.release++; },
      },
      "../../../../../lib/fulfillment/worker": {
        fulfillPaidOrder: async (input) => {
          state.calls.worker.push(input);
          if (state.workerError) throw state.workerError;
          return { outcome: "SUBMITTED", attempt: { attempt_status: "SUBMITTED", provider_order_id: "mock-provider-order" } };
        },
        loadDynamicOrderExecutionContext: async (id) => ({
          order: { id },
          serviceId: "service-id",
          provider: "reliablesmm",
          providerServiceId: "2037",
          payload: { service: "2037", link: TARGET_URL },
        }),
      },
      "../../../../../lib/fulfillment/reliablesmm/request": { buildReliableSMMProviderRequest },
      "../../../../../lib/targets/contracts": {
        normalizeTargetForService: ({ platformSlug, targetType, value, transformId, transformVersion }) => {
          if (platformSlug !== "instagram" || targetType !== "url" || !/^https:\/\/(www\.)?instagram\.com\/p\/[A-Za-z0-9_-]+\/?$/.test(value)) {
            return { valid: false, reason: "Instagram post URL required." };
          }
          if (transformId !== "normalize_url" || transformVersion !== 1) return { valid: false, reason: "Unsupported transform." };
          return { valid: true, target: value };
        },
        resolveTargetInputField: (fields, targetType) => {
          const matches = fields.filter((field) => targetType === "url" && ["url", "post_url"].includes(field.inputType ?? field.input_type));
          return matches.length === 1 ? { field: matches[0], error: null } : { field: null, error: "Target field invalid." };
        },
      },
    },
    env,
  );
  const response = (headers = {}) => route.POST(new Request("http://localhost:3000/api/admin/fulfillment/canary-vnt-610a68", {
    method: "POST",
    headers: { origin: "http://localhost:3000", ...headers },
  }));
  return { route, state, env, response, logs };
}

const unauthorized = createRouteHarness();
unauthorized.state.user = null;
assert.equal((await unauthorized.response()).status, 401);
assert.equal(unauthorized.state.adminLookupCount, 0);

const nonAdmin = createRouteHarness();
nonAdmin.state.isAdmin = null;
assert.equal((await nonAdmin.response()).status, 403);
assert.equal(nonAdmin.state.adminLookupCount, 0);

const crossOrigin = createRouteHarness();
assert.equal((await crossOrigin.response({ origin: "https://attacker.example" })).status, 403);
assert.equal(crossOrigin.state.adminLookupCount, 0);

const disabled = createRouteHarness();
disabled.env.PANELS_LIVE_FULFILLMENT_ENABLED = "false";
assert.equal((await disabled.response()).status, 423);
assert.equal(disabled.state.calls.claim, 0);
assert.equal(disabled.state.calls.worker.length, 0);

for (const patch of [
  { payment_status: "UNPAID" },
  { fulfillment_status: "SUBMITTING" },
  { quantity: 101 },
  { total: 10 },
  { currency: "USD" },
  { target_type: "post_url" },
]) {
  const ineligible = createRouteHarness();
  ineligible.state.order = { ...ineligible.state.order, ...patch };
  assert.equal((await ineligible.response()).status, 409);
  assert.equal(ineligible.state.calls.claim, 0);
  assert.equal(ineligible.state.calls.worker.length, 0);
}

for (const mappings of [
  [],
  [{ ...createRouteHarness().state.mappings[0], provider_service_id: "9999" }],
  [{ ...createRouteHarness().state.mappings[0], service_input_fields: { key: "username", input_type: "username" } }],
]) {
  const invalidMapping = createRouteHarness();
  invalidMapping.state.mappings = mappings;
  assert.equal((await invalidMapping.response()).status, 409);
  assert.equal(invalidMapping.state.calls.claim, 0);
  assert.equal(invalidMapping.state.calls.worker.length, 0);
}

const invalidTarget = createRouteHarness();
invalidTarget.state.order = {
  ...invalidTarget.state.order,
  input_values: { post_url: "https://www.tiktok.com/@creator/video/1234567890123456789" },
};
assert.equal((await invalidTarget.response()).status, 409);
assert.equal(invalidTarget.state.calls.claim, 0);

const duplicate = createRouteHarness();
duplicate.state.attempts = [{ id: "attempt-id", attempt_status: "UNKNOWN_PENDING_RECONCILIATION" }];
assert.equal((await duplicate.response()).status, 409);
assert.equal(duplicate.state.calls.claim, 0);
assert.equal(duplicate.state.calls.worker.length, 0);

const concurrent = createRouteHarness();
concurrent.state.claimResult = false;
assert.equal((await concurrent.response()).status, 409);
assert.equal(concurrent.state.calls.worker.length, 0);

const submitted = createRouteHarness();
const submittedResponse = await submitted.response();
assert.equal(submittedResponse.status, 200);
assert.equal(submittedResponse.body.outcome, "SUBMITTED");
assert.equal(submitted.state.calls.claim, 1);
assert.equal(submitted.state.calls.release, 1);
assert.equal(submitted.state.calls.worker.length, 1);
assert.equal(submitted.state.calls.worker[0].orderId, ORDER_ID);
assert.equal(submitted.state.calls.worker[0].orderSpecificAuthorization, PUBLIC_ORDER_ID);
assert.equal(submitted.state.calls.worker[0].allowLiveSubmission, true);
assert.deepEqual(
  submitted.state.calls.transitions.map((transition) => [transition.args.p_from, transition.args.p_to]),
  [["NOT_STARTED", "SUBMITTING"], ["SUBMITTING", "SUBMITTED"]],
);

const failedWorker = createRouteHarness();
failedWorker.state.workerError = Object.assign(new Error("provider failure must not be logged"), { code: "HTTP_ERROR" });
assert.equal((await failedWorker.response()).status, 502);
assert.equal(failedWorker.state.calls.release, 1);
assert.equal(JSON.stringify(failedWorker.logs).includes(TARGET_URL), false);
assert.equal(JSON.stringify(failedWorker.logs).includes("provider failure must not be logged"), false);
assert.equal(JSON.stringify(failedWorker.logs).includes("mock-provider-key"), false);

class MockReliableSMMError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function createAttemptHarness({ gateFails = false, createError = null } = {}) {
  const calls = [];
  const admin = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "acquire_provider_operation_lock") return { data: true, error: null };
      if (name === "acquire_submission_lease") return { data: true, error: null };
      if (name === "record_submission_boundary") return { data: true, error: null };
      if (name === "record_submission_failure") return { data: true, error: null };
      if (name === "release_provider_operation_lock") return { data: true, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };
  const adapter = {
    async acquireRequestGate() {
      if (gateFails) throw new MockReliableSMMError("Request gate unavailable", 429, "PROVIDER_RATE_LIMITED");
    },
    async createOrder() {
      if (createError) throw createError;
      throw new Error("mock adapter does not submit");
    },
  };
  return { admin, adapter, calls };
}

function loadAttemptModule() {
  return compile(
    fs.readFileSync("lib/fulfillment/reliablesmm/attempt.ts", "utf8"),
    {
      "server-only": {},
      "node:crypto": crypto,
      "../../supabase/server": { createSupabaseAdminClient: () => ({}) },
      "../service": { assertOrderEligibleForFulfillment: async () => ({}) },
      "./adapter": { ReliableSMMAdapter: class {} },
      "./pricing": { reliableSMMCost: () => 1 },
      "./client": { ReliableSMMError: MockReliableSMMError, ReliableSMMReadOnlyClient: class {} },
      "./target": { assertReliableSMMTarget: () => ({ link: TARGET_URL }) },
      "./request": { buildReliableSMMProviderRequest },
      "../../targets/contracts": { resolveTargetInputField: () => ({ field: null, error: "unused" }) },
    },
  );
}

const attemptModule = loadAttemptModule();
for (const { error, ambiguous } of [
  { error: new MockReliableSMMError("provider returned a gateway error", 502, "HTTP_ERROR"), ambiguous: true },
  { error: new MockReliableSMMError("request timed out", 408, "TIMEOUT"), ambiguous: true },
  { error: new MockReliableSMMError("provider explicitly rejected the order", 200, "PROVIDER_REJECTED"), ambiguous: false },
]) {
  const harness = createAttemptHarness({ createError: error });
  await assert.rejects(() => attemptModule.executeReliableSMMSubmission({
    orderId: ORDER_ID,
    providerServiceId: "2037",
    targetValue: TARGET_URL,
    quantity: 100,
    payload: { link: TARGET_URL },
    adapter: harness.adapter,
    admin: harness.admin,
    attemptId: "attempt-uuid",
  }));
  const failure = harness.calls.find((call) => call.name === "record_submission_failure");
  assert.ok(failure);
  assert.equal(failure.args.p_ambiguous, ambiguous);
  assert.equal(failure.args.p_error, error.code);
  assert.equal(harness.calls.filter((call) => call.name === "record_submission_boundary").length, 1);
}

const preBoundaryFailure = createAttemptHarness({ gateFails: true });
await assert.rejects(() => attemptModule.executeReliableSMMSubmission({
  orderId: ORDER_ID,
  providerServiceId: "2037",
  targetValue: TARGET_URL,
  quantity: 100,
  payload: { link: TARGET_URL },
  adapter: preBoundaryFailure.adapter,
  admin: preBoundaryFailure.admin,
  attemptId: "attempt-uuid",
}));
const preBoundaryRecord = preBoundaryFailure.calls.find((call) => call.name === "record_submission_failure");
assert.equal(preBoundaryRecord.args.p_ambiguous, false);
assert.equal(preBoundaryFailure.calls.filter((call) => call.name === "record_submission_boundary").length, 0);

const canaryRouteSource = fs.readFileSync("app/api/internal/fulfillment/canary/route.ts", "utf8");
assert.match(canaryRouteSource, /CANARY_ORDER_ID = "ab1030cc-41b9-4f57-bae8-4226d9f6423d"/);

function createWorkerHarness(env) {
  const calls = [];
  const execution = {
    id: ORDER_ID,
    public_order_id: PUBLIC_ORDER_ID,
    total: 0.1,
    input_schema_version: 1,
    input_schema_snapshot: [{ key: "post_url" }],
    input_values: { post_url: TARGET_URL },
    services: { slug: "instagram-views" },
  };
  const worker = compile(
    fs.readFileSync("lib/fulfillment/worker.ts", "utf8"),
    {
      "server-only": {},
      "../supabase/server": { createSupabaseAdminClient: () => ({}) },
      "./provider-input-transform": { buildProviderPayload: () => ({}) },
      "./order-execution-mode": {
        resolveOrderExecutionMode: (order) => order?.input_schema_snapshot ? "DYNAMIC_VALID" : "LEGACY",
      },
      "./panelfollows/attempt": {
        claimPanelFollowsAttempt: async () => ({ kind: "existing", attempt: {} }),
        submitPanelFollowsAttempt: async () => ({}),
      },
      "./resolver": { resolveProviderForService: async () => ({ mapping: { provider: "reliablesmm" } }) },
      "./reliablesmm/attempt": {
        fulfillReliableSMMDynamicOrder: async (input) => { calls.push(input); return { outcome: "SUBMITTED" }; },
        fulfillReliableSMMOrder: async () => ({ outcome: "SUBMITTED" }),
      },
      "./provider-mapping-consistency": { assertProviderMappingConsistency: () => ({}) },
      "../pricing/customer-price": { assertPayableOrderTotal() {} },
      "./service-input-mapping": { normalizePersistedProviderInputMappings: () => [] },
    },
    env,
  );
  const deps = {
    resolveProviderForService: async () => ({ mapping: { provider: "reliablesmm" } }),
    loadDynamicOrderExecutionContext: async () => ({
      serviceId: "service-id",
      provider: "reliablesmm",
      providerServiceId: "2037",
      payload: { link: TARGET_URL },
    }),
    fulfillReliableSMMDynamicOrder: async (input) => { calls.push(input); return { outcome: "SUBMITTED" }; },
  };
  return { worker, execution, calls, deps };
}

const workerEnv = { RELIABLESMM_CANARY_ORDER_ID: "ab1030cc-41b9-4f57-bae8-4226d9f6423d" };
const allowedSpecificWorker = createWorkerHarness(workerEnv);
const specificResult = await allowedSpecificWorker.worker.fulfillPaidOrder({
  orderId: ORDER_ID,
  vantaSlug: "instagram-views",
  targetType: "url",
  targetValue: "dynamic-configured-order",
  quantity: 100,
  prefetchedOrder: allowedSpecificWorker.execution,
  orderSpecificAuthorization: PUBLIC_ORDER_ID,
  allowLiveSubmission: true,
}, allowedSpecificWorker.deps);
assert.equal(specificResult.outcome, "SUBMITTED");
assert.equal(allowedSpecificWorker.calls.length, 1);
assert.equal(allowedSpecificWorker.calls[0].allowLiveSubmission, true);

const wrongPublicReference = createWorkerHarness(workerEnv);
wrongPublicReference.execution.public_order_id = "VNT-OTHER";
await assert.rejects(() => wrongPublicReference.worker.fulfillPaidOrder({
  orderId: ORDER_ID,
  vantaSlug: "instagram-views",
  targetType: "url",
  targetValue: "dynamic-configured-order",
  quantity: 100,
  prefetchedOrder: wrongPublicReference.execution,
  orderSpecificAuthorization: PUBLIC_ORDER_ID,
  allowLiveSubmission: true,
}, wrongPublicReference.deps), /restricted to the explicitly authorized canary order/i);
assert.equal(wrongPublicReference.calls.length, 0);

const wrongOrderId = createWorkerHarness(workerEnv);
wrongOrderId.execution.id = "11111111-2222-4333-8444-555555555555";
await assert.rejects(() => wrongOrderId.worker.fulfillPaidOrder({
  orderId: wrongOrderId.execution.id,
  vantaSlug: "instagram-views",
  targetType: "url",
  targetValue: "dynamic-configured-order",
  quantity: 100,
  prefetchedOrder: wrongOrderId.execution,
  orderSpecificAuthorization: PUBLIC_ORDER_ID,
  allowLiveSubmission: true,
}, wrongOrderId.deps), /restricted to the explicitly authorized canary order/i);
assert.equal(wrongOrderId.calls.length, 0);

const oldCanary = createWorkerHarness({ RELIABLESMM_CANARY_ORDER_ID: "ab1030cc-41b9-4f57-bae8-4226d9f6423d" });
oldCanary.execution.id = "ab1030cc-41b9-4f57-bae8-4226d9f6423d";
oldCanary.execution.public_order_id = "VNT-165690";
const oldCanaryAutomatic = createWorkerHarness({
  PANELS_LIVE_FULFILLMENT_ENABLED: "true",
  RELIABLESMM_CANARY_ORDER_ID: oldCanary.execution.id,
});
oldCanaryAutomatic.execution.id = oldCanary.execution.id;
oldCanaryAutomatic.execution.public_order_id = oldCanary.execution.public_order_id;
await assert.rejects(() => oldCanaryAutomatic.worker.fulfillPaidOrder({
  orderId: oldCanaryAutomatic.execution.id,
  vantaSlug: "instagram-views",
  targetType: "url",
  targetValue: "https://instagram.com/p/old-canary",
  quantity: 100,
  prefetchedOrder: oldCanaryAutomatic.execution,
  allowLiveSubmission: true,
}, oldCanaryAutomatic.deps), /restricted to the explicitly authorized canary order/i);
assert.equal(oldCanaryAutomatic.calls.length, 0, "the pinned canary cannot be auto-submitted by the normal live worker");

assert.equal((await oldCanary.worker.fulfillPaidOrder({
  orderId: oldCanary.execution.id,
  vantaSlug: "instagram-views",
  targetType: "url",
  targetValue: "https://instagram.com/p/old-canary",
  quantity: 100,
  prefetchedOrder: oldCanary.execution,
  allowLiveSubmission: true,
  canaryOrderAuthorization: true,
}, oldCanary.deps)).outcome, "SUBMITTED");

const regularLiveWorker = createWorkerHarness({
  PANELS_LIVE_FULFILLMENT_ENABLED: "true",
  RELIABLESMM_CANARY_ORDER_ID: "ab1030cc-41b9-4f57-bae8-4226d9f6423d",
});
assert.equal((await regularLiveWorker.worker.fulfillPaidOrder({
  orderId: regularLiveWorker.execution.id,
  vantaSlug: "instagram-views",
  targetType: "url",
  targetValue: "dynamic-configured-order",
  quantity: 100,
  prefetchedOrder: regularLiveWorker.execution,
  allowLiveSubmission: true,
}, regularLiveWorker.deps)).outcome, "SUBMITTED");
assert.equal(regularLiveWorker.calls.length, 1, "globally enabled live fulfillment is not restricted to the canary pin");

console.log("phase42-order-specific-fulfillment-tests: passed; provider operations mocked");
