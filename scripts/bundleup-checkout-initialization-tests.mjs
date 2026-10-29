import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const user = { id: "10000000-0000-4000-8000-000000000001", email: "owner@example.test" };
const otherUser = { id: "20000000-0000-4000-8000-000000000002", email: "other@example.test" };
const order = {
  id: "30000000-0000-4000-8000-000000000003",
  public_order_id: "VNT-CHECKOUT-01",
  total: "12.50",
  currency: "GHS",
  status: "PENDING_PAYMENT",
  payment_status: "UNPAID",
  user_id: user.id,
  target_type: "username",
  target_value: "https://www.instagram.com/creator",
  input_schema_snapshot: null,
  input_values: null,
  services: { target_type: "username", platforms: { slug: "instagram" } },
};
const paymentId = "40000000-0000-4000-8000-000000000004";
const paystackUrl = "https://checkout.paystack.com/authorization";
const bundleUpUrl = "https://checkout.bundleup.test/authorization";
const routeSource = fs.readFileSync("app/api/payments/initialize/route.ts", "utf8");

function createRoute({
  env = {},
  currentUser = user,
  orderRecord = order,
  existingPayment = null,
  paystackVerification = { data: { status: "ongoing" } },
  paystackInitialization = {
    data: { authorization_url: paystackUrl, reference: "VANTA-NEW-PAYSTACK" },
  },
  gatewayInitialization = { status: "initialized", paymentId, reference: "VANTA-GW-1", authorizationUrl: bundleUpUrl },
  gatewayError = null,
  queryError = null,
} = {}) {
  const state = {
    queries: [],
    inserts: [],
    updates: [],
    paystackInitializations: [],
    paystackVerifications: [],
    gatewayInitializations: [],
    events: [],
    errors: [],
  };
  const admin = {
    from(table) {
      const query = { table, filters: [], operation: "select" };
      state.queries.push(query);
      return {
        select(columns) { query.columns = columns; return this; },
        eq(column, value) { query.filters.push([column, value]); return this; },
        maybeSingle: async () => {
          if (queryError) return { data: null, error: queryError };
          if (table === "orders") {
            const owned = query.filters.some(([column, value]) => column === "user_id" && value === currentUser?.id);
            return { data: owned && orderRecord?.user_id === currentUser?.id ? orderRecord : null, error: null };
          }
          if (table === "payments" && query.filters.some(([column, value]) => column === "provider" && value === "paystack")) {
            return { data: existingPayment, error: null };
          }
          return { data: null, error: null };
        },
        update(values) {
          query.operation = "update";
          query.values = values;
          return {
            eq(column, value) { query.filters.push([column, value]); return this; },
            then(resolve) {
              state.updates.push(query);
              resolve({ error: null });
            },
          };
        },
        insert(values) {
          state.inserts.push({ table, values });
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  const module = { exports: {} };
  const post = (specifier) => {
    if (specifier === "next/server") {
      return {
        after() {},
        NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) },
      };
    }
    if (specifier === "../../../../lib/supabase/server") {
      return {
        createSupabaseAdminClient: () => admin,
        getCurrentUser: async () => currentUser,
      };
    }
    if (specifier === "../../../../lib/payments/paystack") {
      return {
        verifyPaystack: async (reference) => {
          state.paystackVerifications.push(reference);
          if (paystackVerification instanceof Error) throw paystackVerification;
          return paystackVerification;
        },
        initializePaystack: async (input) => {
          state.paystackInitializations.push(input);
          if (paystackInitialization instanceof Error) throw paystackInitialization;
          return paystackInitialization;
        },
      };
    }
    if (specifier === "../../../../lib/payments/bundleup-gateway-attempt") {
      return {
        initializeBundleUpGatewayAttempt: async (input) => {
          state.gatewayInitializations.push(input);
          if (gatewayError) throw gatewayError;
          return gatewayInitialization;
        },
      };
    }
    if (specifier === "../../../../lib/payments/settle") {
      return {
        verifyAndSettlePaystack: async (...args) => {
          state.events.push(["settle-paystack", args]);
          return { found: true, paid: true };
        },
      };
    }
    if (specifier === "../../../../lib/pricing/customer-price") {
      return {
        assertPayableOrderTotal(value) {
          if (String(value) !== "12.50") throw new Error("Order total is not payable.");
        },
      };
    }
    if (specifier === "../../../../lib/security/rate-limit") {
      return {
        clientIp: () => "127.0.0.1",
        consumeRateLimits: async () => ({ allowed: true }),
        limiterUnavailable: () => ({ status: 503 }),
        rateLimited: () => ({ status: 429 }),
        rulesFor: () => [],
      };
    }
    if (specifier === "../../../../lib/posthog/server") return { captureServerEvent: async (...args) => state.events.push(args) };
    if (specifier === "../../../../lib/posthog/logs") return { flushPostHogLogs: () => {}, logPostHogInfo: () => {} };
    if (specifier === "../../../../lib/targets/contracts") return { validateConfiguredOrderTarget: () => ({ valid: true }) };
    throw new Error(`Unexpected initialization route import: ${specifier}`);
  };
  const compiled = ts.transpileModule(routeSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: post,
    process: { env },
    crypto: { randomUUID: () => "new-reference" },
    URL,
    console: { error(...args) { state.errors.push(args); } },
    after() {},
  });
  return { post: module.exports.POST, state };
}

async function submit(post, extra = {}) {
  return post(new Request("https://vanta.test/api/payments/initialize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ order_id: order.public_order_id, ...extra }),
  }));
}

{
  const test = createRoute();
  const response = await submit(test.post, { provider: "bundleup_gateway", amount: "0.01", currency: "USD" });
  assert.equal(
    response.status,
    200,
    `unset selector defaults to Paystack despite browser provider claims: ${JSON.stringify(test.state.errors)}`,
  );
  assert.equal(test.state.gatewayInitializations.length, 0);
  assert.equal(test.state.paystackInitializations.length, 1);
  assert.equal(JSON.stringify(test.state.paystackInitializations[0]), JSON.stringify({
    email: user.email,
    amount: order.total,
    currency: order.currency,
    reference: "VANTA-VNT-CHECKOUT-01-newreference",
    callbackUrl: "https://vanta.test/payments/callback",
    orderId: order.id,
  }));
  assert.equal(test.state.inserts[0].values.amount, order.total);
  assert.equal(test.state.inserts[0].values.currency, order.currency);
  assert.deepEqual(test.state.queries[0].filters, [
    ["public_order_id", order.public_order_id],
    ["user_id", user.id],
  ]);
}

{
  const test = createRoute({ currentUser: null });
  assert.equal((await submit(test.post)).status, 401);
  assert.equal(test.state.queries.length, 0);
  assert.equal(test.state.gatewayInitializations.length, 0);
}

{
  const test = createRoute({ currentUser: otherUser });
  assert.equal((await submit(test.post)).status, 404);
  assert.equal(test.state.gatewayInitializations.length, 0);
  assert.equal(test.state.paystackInitializations.length, 0);
}

{
  const test = createRoute({
    env: {
      VANTA_CHECKOUT_PAYMENT_PROVIDER: "bundleup_gateway",
      VANTA_BUNDLEUP_GATEWAY_ENABLED: "false",
    },
  });
  assert.equal((await submit(test.post, { provider: "paystack" })).status, 503);
  assert.equal(test.state.gatewayInitializations.length, 0);
  assert.equal(test.state.paystackInitializations.length, 0);
  assert.equal(test.state.inserts.length, 0);
}

{
  const test = createRoute({
    env: {
      VANTA_CHECKOUT_PAYMENT_PROVIDER: "bundleup_gateway",
      VANTA_BUNDLEUP_GATEWAY_ENABLED: "true",
      VANTA_BUNDLEUP_GATEWAY_CHECKOUT_HOSTS: "checkout.bundleup.test",
    },
  });
  const response = await submit(test.post, { provider: "paystack", amount: "0.01", currency: "USD" });
  assert.equal(response.status, 200);
  assert.equal(response.body.provider, "bundleup_gateway");
  assert.equal(response.body.authorization_url, bundleUpUrl);
  assert.equal(JSON.stringify(response.body.allowed_checkout_hosts), JSON.stringify(["checkout.bundleup.test"]));
  assert.equal(response.body.payment_id, paymentId);
  assert.equal(JSON.stringify(test.state.gatewayInitializations), JSON.stringify([{ orderId: order.id, userId: user.id }]));
  assert.equal(test.state.paystackInitializations.length, 0);
  assert.equal(test.state.inserts.length, 0, "gateway attempt helper owns reservation");
  assert.deepEqual(test.state.queries[0].filters, [
    ["public_order_id", order.public_order_id],
    ["user_id", user.id],
  ]);
}

{
  const test = createRoute({
    env: {
      VANTA_CHECKOUT_PAYMENT_PROVIDER: "bundleup_gateway",
      VANTA_BUNDLEUP_GATEWAY_ENABLED: "true",
    },
    existingPayment: {
      id: "existing-paystack",
      reference: "VANTA-EXISTING",
      provider_response: { authorization_url: paystackUrl },
    },
    gatewayError: Object.assign(new Error("ANOTHER_PAYMENT_ATTEMPT_ACTIVE"), { code: "23505" }),
  });
  const response = await submit(test.post);
  assert.equal(response.status, 409);
  assert.match(response.body.error, /Another payment attempt is already active/);
  assert.equal(test.state.gatewayInitializations.length, 1);
  assert.equal(test.state.paystackInitializations.length, 0);
  assert.equal(test.state.inserts.length, 0);
}

for (const [label, result] of [
  ["wrong host", { status: "initialized", paymentId, reference: "VANTA-GW-1", authorizationUrl: "https://evil.test/pay" }],
  ["http URL", { status: "initialized", paymentId, reference: "VANTA-GW-1", authorizationUrl: "http://checkout.bundleup.test/pay" }],
  ["missing payment identity", { status: "initialized", paymentId: "", reference: "VANTA-GW-1", authorizationUrl: bundleUpUrl }],
  ["unresolved reservation", { status: "unresolved", paymentId, reference: "VANTA-GW-1" }],
]) {
  const test = createRoute({
    env: {
      VANTA_CHECKOUT_PAYMENT_PROVIDER: "bundleup_gateway",
      VANTA_BUNDLEUP_GATEWAY_ENABLED: "true",
      VANTA_BUNDLEUP_GATEWAY_CHECKOUT_HOSTS: "checkout.bundleup.test",
    },
    gatewayInitialization: result,
  });
  const response = await submit(test.post);
  assert.notEqual(response.status, 200, `${label} fails closed`);
  assert.equal("authorization_url" in response.body, false);
}

{
  const test = createRoute({
    env: { VANTA_CHECKOUT_PAYMENT_PROVIDER: "bundleup_gateway", VANTA_BUNDLEUP_GATEWAY_ENABLED: "true" },
    gatewayError: new Error("local provider unavailable"),
  });
  assert.equal((await submit(test.post)).status, 502);
  assert.equal(test.state.paystackInitializations.length, 0);
}

{
  const existingPayment = {
    id: "pending-paystack",
    reference: "VANTA-PENDING",
    provider_response: { authorization_url: paystackUrl },
  };
  const test = createRoute({ existingPayment });
  const response = await submit(test.post);
  assert.equal(response.status, 200);
  assert.equal(response.body.authorization_url, paystackUrl);
  assert.equal(test.state.paystackVerifications.length, 1);
  assert.equal(test.state.paystackInitializations.length, 0, "pending Paystack authorization is reused");
  assert.equal(test.state.inserts.length, 0);
}

{
  const test = createRoute({
    existingPayment: {
      id: "pending-paystack",
      reference: "VANTA-PENDING",
      provider_response: { authorization_url: paystackUrl },
    },
    paystackVerification: { data: { status: "success" } },
  });
  assert.equal((await submit(test.post)).status, 409);
  assert.equal(test.state.events[0][0], "settle-paystack", "existing successful Paystack attempt still recovers through its settlement path");
  assert.equal(test.state.gatewayInitializations.length, 0);
}

{
  const test = createRoute({ env: { VANTA_CHECKOUT_PAYMENT_PROVIDER: "unknown" } });
  assert.equal((await submit(test.post)).status, 503);
  assert.equal(test.state.paystackInitializations.length, 0);
  assert.equal(test.state.gatewayInitializations.length, 0);
}

console.log("bundleup-checkout-initialization-tests: passed");
