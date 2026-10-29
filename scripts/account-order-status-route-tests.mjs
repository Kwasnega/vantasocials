import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function compile(source, dependencies) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    process: { env: {} },
    Date,
    Response,
    URL,
    console,
    require(specifier) {
      if (specifier in dependencies) return dependencies[specifier];
      throw new Error(`Unexpected import: ${specifier}`);
    },
  });
  return module.exports;
}

function harness({ user = { id: "customer-1" }, order = {}, attempt = null } = {}) {
  const state = {
    user,
    order: {
      id: "order-1",
      quantity: 100,
      user_id: "customer-1",
      payment_status: "PAID",
      fulfillment_status: "SUBMITTED",
      updated_at: "2026-10-29T04:00:00Z",
      ...order,
    },
    attempt,
    queryFilters: [],
    reconcileCalls: [],
    addOrderCalls: 0,
  };
  const admin = {
    from(table) {
      const filters = {};
      let isAttemptQuery = false;
      const query = {
        select() { return this; },
        eq(key, value) { filters[key] = value; return this; },
        not() { isAttemptQuery = true; return this; },
        order() { return this; },
        limit() { return this; },
        async maybeSingle() {
          state.queryFilters.push({ table, ...filters });
          if (table === "orders") {
            return filters.id ? { data: state.order, error: null }
              : filters.user_id === state.user?.id
                && state.order.user_id === filters.user_id
                && filters.public_order_id === "VNT-123ABC"
                ? { data: state.order, error: null }
                : { data: null, error: null };
          }
          if (table === "provider_orders" && isAttemptQuery) {
            return filters.order_id === state.order.id ? { data: state.attempt, error: null } : { data: null, error: null };
          }
          if (table === "customer_provider_order_status") {
            return {
              data: {
                status: "PROCESSING",
                start_count: 50,
                remains: 25,
                updated_at: "2026-10-29T04:00:00Z",
              },
              error: null,
            };
          }
          throw new Error(`Unexpected maybeSingle query: ${table}`);
        },
        async single() {
          state.queryFilters.push({ table, ...filters });
          return { data: state.order, error: null };
        },
      };
      return query;
    },
  };
  const route = compile(
    fs.readFileSync("app/api/account/orders/[id]/status/route.ts", "utf8"),
    {
      "next/server": { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } },
      "../../../../../../lib/supabase/server": {
        getCurrentUser: async () => state.user,
        createSupabaseAdminClient: () => admin,
      },
      "../../../../../../lib/security/rate-limit": {
        clientIp: () => "127.0.0.1",
        consumeRateLimits: async () => ({ allowed: true }),
        limiterUnavailable: () => new Response(null, { status: 503 }),
        rateLimited: () => new Response(null, { status: 429 }),
        rulesFor: () => [],
      },
      "../../../../../../lib/fulfillment/reliablesmm/reconcile": {
        reconcileReliableSMMAttempt: async (id) => {
          state.reconcileCalls.push(id);
          state.order.fulfillment_status = "COMPLETED";
          return { outcome: "RECONCILED", attemptId: id, status: "COMPLETED" };
        },
        syncReliableSMMObservedStatus: async (id) => {
          state.reconcileCalls.push(`cached:${id}`);
          state.order.fulfillment_status = state.attempt.status;
          return { outcome: "RECONCILED", status: state.attempt.status };
        },
      },
    },
  );
  return { state, GET: route.GET };
}

const params = { params: Promise.resolve({ id: "VNT-123ABC" }) };
const activeAttempt = {
  id: "attempt-1",
  provider: "reliablesmm",
  provider_order_id: "provider-1",
  attempt_status: "SUBMITTED",
  manual_review_state: "NONE",
  next_poll_at: null,
};

{
  const { GET } = harness({ user: null });
  const response = await GET(new Request("http://localhost/status"), params);
  assert.equal(response.status, 401);
}

{
  const { state, GET } = harness({ order: { id: "foreign-order", user_id: "another-customer" } });
  const response = await GET(new Request("http://localhost/status"), params);
  assert.equal(response.status, 404);
  assert.equal(state.reconcileCalls.length, 0);
  assert.ok(state.queryFilters.some((query) => query.table === "orders" && query.user_id === "customer-1"));
}

{
  const { state, GET } = harness({ attempt: activeAttempt });
  const response = await GET(new Request("http://localhost/status"), params);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.fulfillmentStatus, "COMPLETED");
  assert.deepEqual(state.reconcileCalls, ["attempt-1"]);
  assert.equal(state.addOrderCalls, 0);

  // Phase 3 security assert: no sensitive provider fields in customer response
  assert.equal(body.provider, undefined);
  assert.equal(body.providerOrderId, undefined);
  assert.equal(body.provider_order_id, undefined);
  assert.equal(body.providerCost, undefined);
  assert.equal(body.rawResponse, undefined);
}

{
  const { state, GET } = harness({
    attempt: { ...activeAttempt, next_poll_at: new Date(Date.now() + 60_000).toISOString() },
  });
  await GET(new Request("http://localhost/status"), params);
  assert.equal(state.reconcileCalls.length, 0);
}

{
  const { state, GET } = harness({
    order: { fulfillment_status: "COMPLETED" },
    attempt: activeAttempt,
  });
  await GET(new Request("http://localhost/status"), params);
  assert.equal(state.reconcileCalls.length, 0);
}

{
  const { state, GET } = harness({
    attempt: { ...activeAttempt, status: "COMPLETED" },
  });
  const response = await GET(new Request("http://localhost/status"), params);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.fulfillmentStatus, "COMPLETED");
  assert.deepEqual(state.reconcileCalls, ["cached:attempt-1"]);
}

console.log("Account order status route tests passed; safe responses verified.");
