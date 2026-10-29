import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function harness({
  env = { PANELS_LIVE_FULFILLMENT_ENABLED: "true" },
  order = {},
  attempt = null,
  workerResult = { outcome: "SUBMITTED", attempt: { attempt_status: "SUBMITTED" } },
  workerError = null,
} = {}) {
  const state = {
    env,
    order: {
      id: "order-1",
      total: 1,
      service_id: "service-1",
      payment_status: "PAID",
      fulfillment_status: "NOT_STARTED",
      target_type: "url",
      target_value: "https://www.instagram.com/p/example/",
      quantity: 100,
      input_schema_version: 1,
      input_schema_snapshot: [{ key: "link", inputType: "post_url" }],
      input_values: { link: "https://www.instagram.com/p/example/" },
      services: { id: "service-1", slug: "instagram-views", provider: "reliablesmm", provider_service_id: "2037" },
      ...order,
    },
    attempt,
    workerCalls: [],
    rpcCalls: [],
    claimCalls: [],
    releaseCalls: [],
    eventCalls: [],
  };
  const admin = {
    from(table) {
      const filters = {};
      const builder = {
        select() { return this; },
        eq(key, value) { filters[key] = value; return this; },
        order() { return this; },
        limit() { return this; },
        async maybeSingle() {
          if (table === "orders") return { data: state.order, error: null };
          if (table === "provider_orders") return { data: state.attempt, error: null };
          throw new Error(`Unexpected maybeSingle table: ${table}`);
        },
        async insert(row) {
          if (table === "provider_order_events") {
            state.eventCalls.push(row);
            return { data: null, error: null };
          }
          throw new Error(`Unexpected insert table: ${table}`);
        },
        then(resolve, reject) {
          if (table === "service_provider_input_mappings") {
            return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          }
          return Promise.reject(new Error(`Unexpected query table: ${table}`)).then(resolve, reject);
        },
      };
      return builder;
    },
    async rpc(name, args) {
      state.rpcCalls.push({ name, args });
      return { data: true, error: null };
    },
  };
  const source = fs.readFileSync("lib/fulfillment/dispatch-paid-order.ts", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    process: { env: state.env },
    console,
    require(specifier) {
      if (specifier === "server-only") return {};
      if (specifier === "node:crypto") return { randomUUID: () => "owner-token" };
      if (specifier === "../supabase/server") return { createSupabaseAdminClient: () => admin };
      if (specifier === "./claims") return {
        claimOrder: async (...args) => { state.claimCalls.push(args); return true; },
        releaseOrderClaim: async (...args) => { state.releaseCalls.push(args); },
      };
      if (specifier === "./worker") return {
        fulfillPaidOrder: async (input) => {
          state.workerCalls.push(input);
          if (workerError) throw workerError;
          return workerResult;
        },
      };
      if (specifier === "./service-input-mapping") return {
        normalizePersistedProviderInputMappings: (mappings) => mappings ?? [],
      };
      throw new Error(`Unexpected import: ${specifier}`);
    },
  });
  return { state, dispatchPaidOrder: module.exports.dispatchPaidOrder };
}

{
  const test = harness({ env: { PANELS_LIVE_FULFILLMENT_ENABLED: "false" } });
  assert.equal((await test.dispatchPaidOrder("order-1")).outcome, "LIVE_FULFILLMENT_DISABLED");
  assert.equal(test.state.claimCalls.length, 0);
  assert.equal(test.state.workerCalls.length, 0);
  assert.ok(test.state.eventCalls.some((e) => e.error_code === "LIVE_FULFILLMENT_DISABLED"));
}

{
  const test = harness({ env: { PANELS_LIVE_FULFILLMENT_ENABLED: "true", R4_TEST_MODE: "true" } });
  assert.equal((await test.dispatchPaidOrder("order-1")).outcome, "TEST_MODE_BLOCKED");
  assert.equal(test.state.workerCalls.length, 0);
  assert.ok(test.state.eventCalls.some((e) => e.error_code === "TEST_MODE_BLOCKED"));
}

{
  const test = harness({
    env: {
      PANELS_LIVE_FULFILLMENT_ENABLED: "true",
      RELIABLESMM_CANARY_ORDER_ID: "order-1",
    },
  });
  assert.equal((await test.dispatchPaidOrder("order-1")).outcome, "CANARY_PINNED_ORDER_REQUIRES_EXPLICIT_ACTION");
  assert.equal(test.state.claimCalls.length, 0);
  assert.equal(test.state.workerCalls.length, 0);
  assert.ok(test.state.eventCalls.some((e) => e.error_code === "CANARY_PINNED_ORDER_REQUIRES_EXPLICIT_ACTION"));
}

{
  const test = harness({ order: { payment_status: "UNPAID" } });
  assert.equal((await test.dispatchPaidOrder("order-1")).outcome, "ORDER_NOT_ELIGIBLE");
  assert.equal(test.state.claimCalls.length, 0);
  assert.ok(test.state.eventCalls.some((e) => e.error_code === "ORDER_NOT_ELIGIBLE"));
}

{
  const test = harness({
    order: { services: { slug: "instagram-views", provider: "panelfollows", provider_service_id: "42" } },
  });
  assert.equal((await test.dispatchPaidOrder("order-1")).outcome, "PROVIDER_NOT_SUPPORTED");
  assert.equal(test.state.claimCalls.length, 0);
  assert.ok(test.state.eventCalls.some((e) => e.error_code === "PROVIDER_NOT_SUPPORTED"));
}

{
  const test = harness({
    env: {
      PANELS_LIVE_FULFILLMENT_ENABLED: "true",
      RELIABLESMM_CANARY_ORDER_ID: "a-different-pinned-order",
    },
  });
  assert.equal((await test.dispatchPaidOrder("order-1")).outcome, "SUBMITTED");
  assert.equal(test.state.workerCalls.length, 1);
  assert.equal(test.state.workerCalls[0].allowLiveSubmission, true);
  assert.deepEqual(
    test.state.rpcCalls.filter((call) => call.name === "transition_fulfillment_state").map((call) => [call.args.p_from, call.args.p_to]),
    [["NOT_STARTED", "SUBMITTING"], ["SUBMITTING", "SUBMITTED"]],
  );
  assert.equal(test.state.releaseCalls.length, 1);
}

{
  const test = harness({
    attempt: { id: "attempt-1", attempt_status: "FAILED_BEFORE_SUBMISSION", provider_order_id: null },
    workerError: new Error("provider error"),
  });
  await assert.rejects(test.dispatchPaidOrder("order-1"), /provider error/);
  assert.ok(test.state.rpcCalls.some((call) =>
    call.name === "transition_fulfillment_state"
    && call.args.p_from === "NOT_STARTED"
    && call.args.p_to === "SUBMITTING"
  ));
  assert.equal(test.state.releaseCalls.length, 1);
}

{
  const test = harness({
    attempt: { id: "attempt-1", attempt_status: "UNKNOWN_PENDING_RECONCILIATION", provider_order_id: null },
    workerError: new Error("unknown outcome"),
  });
  await assert.rejects(test.dispatchPaidOrder("order-1"), /unknown outcome/);
  assert.ok(test.state.rpcCalls.some((call) => call.name === "require_provider_manual_review"));
  assert.equal(test.state.releaseCalls.length, 1);
}

console.log("Paid order dispatch tests passed; all provider operations mocked.");
