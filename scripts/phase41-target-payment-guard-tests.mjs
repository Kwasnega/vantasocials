import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function compile(source, dependencies = {}) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    URL,
    Request,
    process: { env: {} },
    console: { error() {} },
    require(specifier) {
      if (specifier in dependencies) return dependencies[specifier];
      throw new Error(`Unexpected import: ${specifier}`);
    },
  });
  return module.exports;
}

const targetContracts = compile(fs.readFileSync("lib/targets/contracts.ts", "utf8"));
const invalidOrder = {
  id: "order-id",
  public_order_id: "VNT-123456",
  total: "1.00",
  currency: "GHS",
  status: "PENDING_PAYMENT",
  payment_status: "UNPAID",
  user_id: "user-id",
  target_type: "url",
  target_value: "https://instagram.com/account-not-post",
  input_schema_snapshot: null,
  input_values: null,
  services: { target_type: "url", platforms: { slug: "instagram" } },
};
const initialized = { paystack: 0, bundleup: 0 };
const admin = {
  from(table) {
    assert.equal(table, "orders");
    const builder = {
      select() { return this; },
      eq() { return this; },
      async maybeSingle() { return { data: invalidOrder, error: null }; },
    };
    return builder;
  },
};
const paymentRoute = compile(fs.readFileSync("app/api/payments/initialize/route.ts", "utf8"), {
  "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) }, after() {} },
  "../../../../lib/supabase/server": {
    createSupabaseAdminClient: () => admin,
    getCurrentUser: async () => ({ id: "user-id" }),
  },
  "../../../../lib/payments/paystack": {
    initializePaystack: async () => { initialized.paystack += 1; throw new Error("should not initialize"); },
    verifyPaystack: async () => { throw new Error("should not verify"); },
  },
  "../../../../lib/payments/bundleup-gateway-attempt": {
    initializeBundleUpGatewayAttempt: async () => { initialized.bundleup += 1; throw new Error("should not initialize"); },
  },
  "../../../../lib/payments/settle": { verifyAndSettlePaystack: async () => { throw new Error("should not settle"); } },
  "../../../../lib/pricing/customer-price": { assertPayableOrderTotal() {} },
  "../../../../lib/targets/contracts": targetContracts,
  "../../../../lib/security/rate-limit": {
    clientIp: () => "127.0.0.1",
    consumeRateLimits: async () => ({ allowed: true }),
    limiterUnavailable: () => ({ status: 503 }),
    rateLimited: () => ({ status: 429 }),
    rulesFor: () => [],
  },
  "../../../../lib/posthog/server": { captureServerEvent() {} },
  "../../../../lib/posthog/logs": { flushPostHogLogs() {}, logPostHogInfo() {} },
});

const response = await paymentRoute.POST(new Request("http://localhost/api/payments/initialize", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ order_id: invalidOrder.public_order_id }),
}));
assert.equal(response.status, 409);
assert.match(response.body.error, /Instagram post or reel URL/);
assert.deepEqual(initialized, { paystack: 0, bundleup: 0 }, "invalid saved targets cannot initialize a payment");

let walletDebits = 0;
const walletRoute = compile(fs.readFileSync("app/api/payments/wallet/route.ts", "utf8"), {
  "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) }, after() {} },
  "../../../../lib/supabase/server": {
    createSupabaseAdminClient: () => ({
      from: () => ({
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: invalidOrder, error: null }; },
      }),
      async rpc() { walletDebits += 1; return { data: { id: "debit-id" }, error: null }; },
    }),
    getCurrentUser: async () => ({ id: "user-id" }),
  },
  "../../../../lib/security/rate-limit": {
    clientIp: () => "127.0.0.1",
    consumeRateLimits: async () => ({ allowed: true }),
    limiterUnavailable: () => ({ status: 503 }),
    rateLimited: () => ({ status: 429 }),
    rulesFor: () => [],
  },
  "../../../../lib/pricing/customer-price": { assertPayableOrderTotal() {} },
  "../../../../lib/targets/contracts": targetContracts,
  "../../../../lib/posthog/server": { captureServerEvent() {} },
});
const walletResponse = await walletRoute.POST(new Request("http://localhost/api/payments/wallet", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ order_id: invalidOrder.public_order_id }),
}));
assert.equal(walletResponse.status, 409);
assert.equal(walletDebits, 0, "invalid saved targets cannot debit the wallet");

const configurator = fs.readFileSync("components/services/ServiceConfigurator.tsx", "utf8");
assert.match(configurator, /getTargetRequirements/);
assert.match(configurator, /normalizeTargetForService/);
assert.match(configurator, /aria-invalid/);
assert.match(configurator, /targetRequirements\.example/);
assert.match(configurator, /disabled=\{submitting \|\| !quantityValid/);

console.log("phase41-target-payment-guard-tests: passed");
