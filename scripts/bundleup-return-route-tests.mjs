import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const paymentId = "00000000-0000-4000-8000-000000000001";

function loadRoute({
  user = { id: "owner-user" },
  attempt = { id: paymentId, order_id: "order-1" },
  queryError = null,
  rateAllowed = true,
  result = { status: "pending" },
  reconciliationError = null,
} = {}) {
  const state = {
    reconciliations: [],
    predicates: [],
    rateRules: null,
    afterCallbacks: [],
  };
  const query = {
    select(columns) {
      state.selectedColumns = columns;
      return this;
    },
    eq(column, value) {
      state.predicates.push([column, value]);
      return this;
    },
    async maybeSingle() {
      return { data: attempt, error: queryError };
    },
  };
  const admin = {
    from(table) {
      state.table = table;
      return query;
    },
  };
  const dependencies = {
    "next/server": {
      after(callback) {
        state.afterCallbacks.push(callback);
      },
      NextResponse: {
        json(body, init = {}) {
          return new Response(JSON.stringify(body), {
            status: init.status ?? 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    },
    "../../../../../lib/supabase/server": {
      getCurrentUser: async () => user,
      createSupabaseAdminClient: () => admin,
    },
    "../../../../../lib/payments/bundleup-gateway-attempt": {
      async reconcileBundleUpGatewayAttempt(input) {
        state.reconciliations.push(input);
        if (reconciliationError) throw reconciliationError;
        return result;
      },
    },
    "../../../../../lib/security/rate-limit": {
      clientIp: () => "127.0.0.1",
      async consumeRateLimits(rules) {
        state.rateRules = rules;
        return { allowed: rateAllowed, retryAfterSeconds: 1 };
      },
      limiterUnavailable: () => Response.json({ error: "Rate limiter unavailable." }, { status: 503 }),
      rateLimited: () => Response.json({ error: "Rate limited." }, { status: 429 }),
      rulesFor: (...args) => args,
    },
    "../../../../../lib/fulfillment/dispatch-paid-order": {
      async dispatchPaidOrder(orderId) {
        state.dispatchedOrderIds ??= [];
        state.dispatchedOrderIds.push(orderId);
        return { outcome: "SUBMITTED" };
      },
    },
  };
  const source = fs.readFileSync("app/api/payments/bundleup/reconcile/route.ts", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    process: { env: {} },
    Response,
    Request,
    require(specifier) {
      if (dependencies[specifier]) return dependencies[specifier];
      return nativeRequire(specifier);
    },
  };
  vm.runInNewContext(compiled, sandbox, { filename: "bundleup-reconcile-route.js" });
  return { post: module.exports.POST, state };
}

async function post(route, body) {
  return route(new Request("https://vanta.example/api/payments/bundleup/reconcile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

{
  const test = loadRoute({ user: null });
  const response = await post(test.post, { payment_id: paymentId });
  assert.equal(response.status, 401);
  assert.equal(test.state.reconciliations.length, 0);
  assert.equal(test.state.table, undefined);
}

{
  const test = loadRoute();
  const response = await post(test.post, { payment_id: "not-a-uuid" });
  assert.equal(response.status, 400);
  assert.equal(test.state.reconciliations.length, 0);
  assert.equal(test.state.table, undefined);
}

{
  const test = loadRoute({ attempt: null });
  const response = await post(test.post, { payment_id: paymentId });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "Payment attempt not found.");
  assert.deepEqual(test.state.predicates, [
    ["id", paymentId],
    ["user_id", "owner-user"],
    ["provider", "bundleup_gateway"],
  ]);
  assert.equal(test.state.reconciliations.length, 0);
}

{
  const test = loadRoute();
  const response = await post(test.post, {
    payment_id: paymentId,
    amount: 100,
    currency: "GHS",
    provider_reference: "browser-controlled",
    intent_id: "browser-controlled",
    settlement: true,
  });
  assert.equal(response.status, 400);
  assert.equal(test.state.reconciliations.length, 0);
}

{
  const test = loadRoute({
    result: { status: "payment_verified", settlement: "settled" },
  });
  const response = await post(test.post, { payment_id: paymentId.toUpperCase() });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "confirmed",
    confirmed: true,
    retryable: false,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(test.state.reconciliations)), [
    { paymentId, userId: "owner-user" },
  ]);
  assert.equal(test.state.afterCallbacks.length, 1, "confirmed settlement schedules order fulfillment");
}

{
  const test = loadRoute({ result: { status: "already_settled", paymentId } });
  const response = await post(test.post, { payment_id: paymentId });
  assert.deepEqual(await response.json(), {
    status: "confirmed",
    confirmed: true,
    retryable: false,
  });
  assert.equal(test.state.afterCallbacks.length, 1, "already-settled confirmation schedules idempotent fulfillment");
}

for (const status of ["initialized", "pending"]) {
  const test = loadRoute({ result: { status } });
  const response = await post(test.post, { payment_id: paymentId });
  assert.deepEqual(await response.json(), {
    status: "pending",
    confirmed: false,
    retryable: true,
  });
  assert.equal(test.state.afterCallbacks.length, 0, "pending payments never schedule fulfillment");
}

for (const status of ["failed", "not_found"]) {
  const test = loadRoute({ result: { status } });
  const response = await post(test.post, { payment_id: paymentId });
  assert.deepEqual(await response.json(), {
    status: "unconfirmed",
    confirmed: false,
    retryable: true,
  });
}

for (const result of [
  { status: "unresolved", reason: "expired" },
  { status: "payment_verified" },
]) {
  const test = loadRoute({ result });
  const response = await post(test.post, { payment_id: paymentId });
  assert.deepEqual(await response.json(), {
    status: "unresolved",
    confirmed: false,
    retryable: true,
  });
}

{
  const test = loadRoute({ reconciliationError: new Error("sensitive internal detail") });
  const response = await post(test.post, { payment_id: paymentId });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Payment status could not be confirmed. Please retry reconciliation.",
  });
}

console.log("bundleup-return-route-tests: passed");
