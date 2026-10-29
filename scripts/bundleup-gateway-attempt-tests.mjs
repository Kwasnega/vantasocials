import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const paymentId = "00000000-0000-4000-8000-000000000001";
const requestTerms = {
  p_order_id: "order-1",
  p_expected_user_id: "user-1",
  p_return_url: "https://vanta.example/payments/callback",
};
const persistedAttempt = {
  id: paymentId,
  order_id: requestTerms.p_order_id,
  user_id: requestTerms.p_expected_user_id,
  provider: "bundleup_gateway",
  reference: "VANTA-GW-00000000000040008000000000000001",
  amount: "12.50",
  currency: "GHS",
  status: "PENDING",
  gateway_initialization_status: "RESERVED",
  gateway_order_reference: "VNT-ORDER-1",
  gateway_customer_email: "customer@example.com",
  gateway_return_url: requestTerms.p_return_url,
  gateway_intent_id: null,
  gateway_reference: null,
  gateway_authorization_url: null,
};
const initializedIntent = {
  intent_id: "a".repeat(64),
  reference: `VANTA-${"a".repeat(64)}`,
  authorization_url: `https://checkout.example/pay/${"a".repeat(64)}`,
  status: "initialized",
  idempotent: false,
};

class TestBundleUpGatewayError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class TestBundleUpGatewayUnresolvedError extends TestBundleUpGatewayError {
  constructor(message = "unresolved") {
    super(message, "HTTP");
  }
}

function clone(value) {
  return structuredClone(value);
}

function loadAttempt({
  env = {},
  initialize = async () => clone(initializedIntent),
  initialAttempt,
  reserveError,
} = {}) {
  const testEnv = {
    VANTA_BUNDLEUP_GATEWAY_ENABLED: "true",
    VANTA_BUNDLEUP_GATEWAY_RETURN_URL: requestTerms.p_return_url,
    VANTA_BUNDLEUP_GATEWAY_CHECKOUT_HOSTS: "checkout.example",
    ...env,
  };
  const state = {
    attempt: initialAttempt ? clone(initialAttempt) : null,
    rpcCalls: [],
    initializeCalls: [],
    terms: null,
  };
  const admin = {
    async rpc(name, args) {
      state.rpcCalls.push({ name, args: clone(args) });
      if (name === "reserve_bundleup_gateway_payment_attempt") {
        if (reserveError) return { data: null, error: reserveError };
        state.terms ??= clone(args);
        if (JSON.stringify(state.terms) !== JSON.stringify(args)) {
          return { data: null, error: new Error("GATEWAY_PAYMENT_TERMS_MISMATCH") };
        }
        if (!state.attempt) state.attempt = clone(persistedAttempt);
        return { data: [clone(state.attempt)], error: null };
      }
      if (name === "claim_bundleup_gateway_payment_initialization") {
        if (state.attempt.gateway_initialization_status !== "RESERVED") {
          return { data: false, error: null };
        }
        state.attempt.gateway_initialization_status = "INITIALIZING";
        return { data: true, error: null };
      }
      if (name === "mark_bundleup_gateway_payment_unknown") {
        if (state.attempt.gateway_initialization_status === "INITIALIZING") {
          state.attempt.gateway_initialization_status = "INITIALIZATION_UNKNOWN";
          return { data: true, error: null };
        }
        return { data: false, error: null };
      }
      if (name === "reject_bundleup_gateway_payment_initialization") {
        state.attempt.gateway_initialization_status = "INITIALIZATION_REJECTED";
        state.attempt.status = "FAILED";
        return { data: true, error: null };
      }
      if (name === "complete_bundleup_gateway_payment_initialization") {
        if (state.attempt.gateway_initialization_status !== "INITIALIZING") {
          return { data: false, error: null };
        }
        state.attempt.gateway_initialization_status = "INITIALIZED";
        state.attempt.gateway_intent_id = args.p_intent_id;
        state.attempt.gateway_reference = args.p_gateway_reference;
        state.attempt.gateway_authorization_url = args.p_authorization_url;
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };

  const source = fs.readFileSync("lib/payments/bundleup-gateway-attempt.ts", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const require = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier === "../supabase/server") {
      return { createSupabaseAdminClient: () => admin };
    }
    if (specifier === "./paystack") {
      return {
        amountToMinorUnits(value) {
          const normalized = value.trim();
          if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error("Invalid amount");
          const [whole, fraction = ""] = normalized.split(".");
          return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
        },
      };
    }
    if (specifier === "./bundleup-gateway") {
      return {
        BundleUpGatewayError: TestBundleUpGatewayError,
        BundleUpGatewayUnresolvedError: TestBundleUpGatewayUnresolvedError,
        async initializeBundleUpPaymentIntent(input) {
          state.initializeCalls.push(clone(input));
          return initialize(input);
        },
      };
    }
    throw new Error(`Unexpected import: ${specifier}`);
  };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require,
    process: { env: testEnv },
    URL,
    BigInt,
    Number,
    Set,
  }, { filename: "bundleup-gateway-attempt.js" });

  return {
    initializeBundleUpGatewayAttempt: module.exports.initializeBundleUpGatewayAttempt,
    state,
  };
}

{
  for (const flag of [undefined, "false"]) {
    const env = { VANTA_BUNDLEUP_GATEWAY_ENABLED: flag };
    const test = loadAttempt({ env });
    await assert.rejects(
      test.initializeBundleUpGatewayAttempt({ orderId: requestTerms.p_order_id, userId: requestTerms.p_expected_user_id }),
      (error) => error.code === "DISABLED",
    );
    assert.equal(test.state.rpcCalls.length, 0);
    assert.equal(test.state.initializeCalls.length, 0);
  }
}

{
  const test = loadAttempt();
  const first = await test.initializeBundleUpGatewayAttempt({
    orderId: requestTerms.p_order_id,
    userId: requestTerms.p_expected_user_id,
  });
  const second = await test.initializeBundleUpGatewayAttempt({
    orderId: requestTerms.p_order_id,
    userId: requestTerms.p_expected_user_id,
  });

  assert.equal(first.status, "initialized");
  assert.equal(second.status, "initialized");
  assert.equal(first.paymentId, paymentId);
  assert.equal(second.paymentId, paymentId);
  assert.equal(test.state.initializeCalls.length, 1);
  assert.deepEqual(test.state.initializeCalls[0], {
    paymentId,
    orderId: persistedAttempt.gateway_order_reference,
    amount: persistedAttempt.amount,
    currency: "GHS",
    customerEmail: persistedAttempt.gateway_customer_email,
  });
  assert.equal(test.state.attempt.gateway_initialization_status, "INITIALIZED");
  assert.equal(
    test.state.rpcCalls.filter(({ name }) => name === "claim_bundleup_gateway_payment_initialization").length,
    1,
  );
}

{
  const test = loadAttempt({
    initialize: async () => {
      throw new TestBundleUpGatewayUnresolvedError("simulated timeout after dispatch");
    },
  });
  const first = await test.initializeBundleUpGatewayAttempt({
    orderId: requestTerms.p_order_id,
    userId: requestTerms.p_expected_user_id,
  });
  const termsAfterFirstAttempt = clone(test.state.terms);
  const retry = await test.initializeBundleUpGatewayAttempt({
    orderId: requestTerms.p_order_id,
    userId: requestTerms.p_expected_user_id,
  });

  assert.equal(first.status, "unresolved");
  assert.equal(retry.status, "unresolved");
  assert.equal(first.paymentId, retry.paymentId);
  assert.equal(test.state.attempt.id, paymentId);
  assert.deepEqual(test.state.terms, termsAfterFirstAttempt);
  assert.equal(test.state.attempt.status, "PENDING");
  assert.equal(test.state.attempt.gateway_initialization_status, "INITIALIZATION_UNKNOWN");
  assert.equal(test.state.initializeCalls.length, 1, "unresolved retries never initialize a second intent");
  assert.equal(
    test.state.rpcCalls.filter(({ name }) => name === "claim_bundleup_gateway_payment_initialization").length,
    1,
  );
}

{
  const test = loadAttempt({
    initialAttempt: {
      ...persistedAttempt,
      status: "PAID",
      gateway_initialization_status: "INITIALIZATION_UNKNOWN",
    },
  });
  const result = await test.initializeBundleUpGatewayAttempt({
    orderId: requestTerms.p_order_id,
    userId: requestTerms.p_expected_user_id,
  });
  assert.equal(result.status, "paid");
  assert.equal(test.state.initializeCalls.length, 0);
}

{
  const test = loadAttempt();
  const inputs = [
    test.initializeBundleUpGatewayAttempt({
      orderId: requestTerms.p_order_id,
      userId: requestTerms.p_expected_user_id,
    }),
    test.initializeBundleUpGatewayAttempt({
      orderId: requestTerms.p_order_id,
      userId: requestTerms.p_expected_user_id,
    }),
  ];
  const results = await Promise.all(inputs);
  assert.equal(test.state.initializeCalls.length, 1, "one claimed attempt makes one gateway request");
  assert.deepEqual(results.map(({ status }) => status).sort(), ["initialized", "unresolved"]);
  assert.equal(test.state.attempt.id, paymentId);
}

{
  const test = loadAttempt({
    initialize: async () => {
      throw new TestBundleUpGatewayError("gateway rejected request", "HTTP", 401);
    },
  });
  const first = await test.initializeBundleUpGatewayAttempt({
    orderId: requestTerms.p_order_id,
    userId: requestTerms.p_expected_user_id,
  });
  const retry = await test.initializeBundleUpGatewayAttempt({
    orderId: requestTerms.p_order_id,
    userId: requestTerms.p_expected_user_id,
  });
  assert.equal(first.status, "rejected");
  assert.equal(retry.status, "rejected");
  assert.equal(test.state.attempt.status, "FAILED");
  assert.equal(test.state.attempt.gateway_initialization_status, "INITIALIZATION_REJECTED");
  assert.equal(test.state.initializeCalls.length, 1);
}

{
  const test = loadAttempt({ reserveError: new Error("GATEWAY_PAYMENT_TERMS_MISMATCH") });
  await assert.rejects(
    test.initializeBundleUpGatewayAttempt({
      orderId: requestTerms.p_order_id,
      userId: requestTerms.p_expected_user_id,
    }),
    /GATEWAY_PAYMENT_TERMS_MISMATCH/,
  );
  assert.equal(test.state.initializeCalls.length, 0, "changed terms fail before gateway dispatch");
}

for (const invalidAttempt of [
  { ...persistedAttempt, user_id: "other-user" },
  { ...persistedAttempt, order_id: "other-order" },
  { ...persistedAttempt, provider: "paystack" },
  { ...persistedAttempt, currency: "USD" },
  { ...persistedAttempt, amount: "0.00" },
]) {
  const test = loadAttempt({ initialAttempt: invalidAttempt });
  await assert.rejects(
    test.initializeBundleUpGatewayAttempt({
      orderId: requestTerms.p_order_id,
      userId: requestTerms.p_expected_user_id,
    }),
  );
  assert.equal(test.state.initializeCalls.length, 0);
}

{
  const test = loadAttempt({
    initialAttempt: {
      ...persistedAttempt,
      gateway_initialization_status: "INITIALIZED",
      gateway_intent_id: initializedIntent.intent_id,
      gateway_reference: initializedIntent.reference,
      gateway_authorization_url: "https://evil.example/pay",
    },
  });
  await assert.rejects(
    test.initializeBundleUpGatewayAttempt({
      orderId: requestTerms.p_order_id,
      userId: requestTerms.p_expected_user_id,
    }),
    /not allowed/,
  );
  assert.equal(test.state.initializeCalls.length, 0);
}

{
  const source = fs.readFileSync("lib/payments/bundleup-gateway-attempt.ts", "utf8");
  const initializeRoute = fs.readFileSync("app/api/payments/initialize/route.ts", "utf8");
  const verifyRoute = fs.readFileSync("app/api/payments/verify/route.ts", "utf8");
  const settlement = fs.readFileSync("lib/payments/settle.ts", "utf8");
  const walletRoute = fs.readFileSync("app/api/account/wallet/deposit/route.ts", "utf8");
  const migration = fs.readFileSync("supabase/migrations/20261026000000_bundleup_gateway_payment_attempts.sql", "utf8");

  assert.doesNotMatch(source, /settle_paystack_order_payment|verifyAndSettlePaystack/);
  assert.match(source, /settle_bundleup_gateway_order_payment/);
  assert.doesNotMatch(source, /initializePaystack/);
  assert.match(initializeRoute, /initializeBundleUpGatewayAttempt/);
  assert.match(initializeRoute, /VANTA_CHECKOUT_PAYMENT_PROVIDER/);
  assert.match(initializeRoute, /initializePaystack/);
  assert.match(verifyRoute, /verifyAndSettlePaystack/);
  assert.match(settlement, /\.eq\("provider", "paystack"\)/);
  assert.match(walletRoute, /initializeWalletPaystack/);
  assert.match(migration, /current_setting\('request\.jwt\.claim\.role', true\)/);
  assert.match(migration, /payments_one_pending_external_payment_per_order_idx/);
  assert.match(migration, /gateway_initialization_status = 'INITIALIZATION_UNKNOWN'/);
  assert.match(migration, /BUNDLEUP_GATEWAY_PAYMENT_TERMS_IMMUTABLE/);
}

console.log("bundleup-gateway-attempt-tests: passed (mocked orchestration; database guarantees unverified)");
