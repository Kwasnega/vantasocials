import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const testSecret = "test-only-vanta-gateway-secret-32-bytes";
const paymentId = "00000000-0000-4000-8000-000000000001";
const intentId = crypto.createHash("sha256")
  .update(`vanta\0idempotency:${paymentId}`, "utf8")
  .digest("hex");
const checkoutUrl = `https://checkout.example/pay/${intentId}`;
const expectedIntent = {
  intent_id: intentId,
  reference: `VANTA-${intentId}`,
  authorization_url: checkoutUrl,
  status: "initialized",
  idempotent: false,
};

function loadGateway({
  env = {},
  now = () => Date.now(),
  timer = setTimeout,
  clearTimer = clearTimeout,
  fetchImpl = async () => new Response(JSON.stringify(expectedIntent), { status: 200 }),
} = {}) {
  const source = fs.readFileSync("lib/payments/bundleup-gateway.ts", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const testEnv = {
    VANTA_BUNDLEUP_GATEWAY_ENABLED: "true",
    VANTA_BUNDLEUP_GATEWAY_BASE_URL: "https://gateway.example",
    VANTA_BUNDLEUP_GATEWAY_ALLOWED_HOSTS: "gateway.example",
    VANTA_BUNDLEUP_GATEWAY_SHARED_SECRET: testSecret,
    VANTA_BUNDLEUP_GATEWAY_RETURN_URL: "https://vanta.example/payments/callback",
    VANTA_BUNDLEUP_GATEWAY_CHECKOUT_HOSTS: "checkout.example",
    ...env,
  };
  const sandbox = {
    module,
    exports: module.exports,
    process: { env: testEnv },
    Date: class TestDate extends Date {
      static now() {
        return now();
      }
    },
    Buffer,
    URL,
    Response,
    TextDecoder,
    AbortController,
    Uint8Array,
    setTimeout: timer,
    clearTimeout: clearTimer,
    fetch: fetchImpl,
    require(specifier) {
      if (specifier === "server-only") return {};
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
      return nativeRequire(specifier);
    },
  };
  vm.runInNewContext(compiled, sandbox, { filename: "bundleup-gateway.js" });
  return { gateway: module.exports, env: testEnv };
}

function validInput(overrides = {}) {
  return {
    paymentId,
    orderId: "VNT-ABC123",
    amount: "12.50",
    currency: "GHS",
    customerEmail: " Customer@Example.com ",
    ...overrides,
  };
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function rawResponse(rawBody, status = 200, headers = {}) {
  return new Response(rawBody, {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

{
  const { gateway } = loadGateway();
  const bodyBytes = Buffer.from('{"order_id":"VNT-ABC123","amount_minor":1250,"currency":"GHS","customer_email":"customer@example.com","return_url":"https://vanta.example/payments/callback"}');
  const canonical = gateway.buildBundleUpGatewayCanonicalMessage({
    timestamp: "1700000000",
    nonce: "Abcdefghijklmnop",
    idempotencyKey: paymentId,
    bodyBytes,
  });
  assert.equal(
    canonical,
    `POST\n/api/gateway/v1/payment-intents\n1700000000\nAbcdefghijklmnop\n${paymentId}\n${crypto.createHash("sha256").update(bodyBytes).digest("hex")}`,
  );
  const signature = crypto.createHmac("sha256", testSecret).update(canonical, "utf8").digest("hex");
  assert.equal(signature, "cbd19d38ba5a0975b3e9c7d0dca83a5aafff4fbcc0b710abc22e0565ebea59ca");
}

for (const env of [
  { VANTA_BUNDLEUP_GATEWAY_ENABLED: undefined },
  { VANTA_BUNDLEUP_GATEWAY_ENABLED: "false" },
]) {
  let calls = 0;
  const testEnv = { ...env };
  const { gateway } = loadGateway({
    env: testEnv,
    fetchImpl: async () => { calls += 1; throw new Error("unexpected network call"); },
  });
  await assert.rejects(
    gateway.initializeBundleUpPaymentIntent(validInput()),
    (error) => error.code === "DISABLED",
  );
  assert.equal(calls, 0, "disabled mode never contacts the gateway");
}

for (const env of [
  { VANTA_BUNDLEUP_GATEWAY_BASE_URL: "http://gateway.example" },
  { VANTA_BUNDLEUP_GATEWAY_BASE_URL: "https://user:pass@gateway.example" },
  { VANTA_BUNDLEUP_GATEWAY_BASE_URL: "https://gateway.example/#fragment" },
  { VANTA_BUNDLEUP_GATEWAY_BASE_URL: "https://unexpected.example" },
  { VANTA_BUNDLEUP_GATEWAY_SHARED_SECRET: "short" },
  { VANTA_BUNDLEUP_GATEWAY_RETURN_URL: "http://vanta.example/callback" },
  { VANTA_BUNDLEUP_GATEWAY_CHECKOUT_HOSTS: "checkout.example:443" },
]) {
  let calls = 0;
  const { gateway } = loadGateway({
    env,
    fetchImpl: async () => { calls += 1; return response(expectedIntent); },
  });
  await assert.rejects(
    gateway.initializeBundleUpPaymentIntent(validInput()),
    (error) => error.code === "CONFIGURATION",
  );
  assert.equal(calls, 0, "invalid configuration is rejected before networking");
}

for (const invalid of [
  { amount: "0.00" },
  { amount: "12.345" },
  { amount: "90071992547409.92" },
  { currency: "USD" },
  { orderId: " VNT-ABC123" },
  { orderId: "unsafe/order" },
  { paymentId: "not-a-uuid" },
  { customerEmail: "invalid" },
]) {
  let calls = 0;
  const { gateway } = loadGateway({
    fetchImpl: async () => { calls += 1; return response(expectedIntent); },
  });
  await assert.rejects(
    gateway.initializeBundleUpPaymentIntent(validInput(invalid)),
    (error) => error.code === "INVALID_INPUT",
  );
  assert.equal(calls, 0);
}

{
  const requests = [];
  let nowMs = 1_700_000_000_000;
  const { gateway } = loadGateway({
    now: () => nowMs,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      nowMs += 1000;
      return response({ ...expectedIntent, idempotent: requests.length > 1 });
    },
  });
  await gateway.initializeBundleUpPaymentIntent(validInput());
  await gateway.initializeBundleUpPaymentIntent(validInput());
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://gateway.example/api/gateway/v1/payment-intents");
  assert.equal(requests[0].init.redirect, "manual");
  assert.equal(requests[0].init.headers["Idempotency-Key"], paymentId);
  assert.equal(requests[1].init.headers["Idempotency-Key"], paymentId);
  assert.equal(requests[0].init.headers["X-Vanta-Timestamp"], "1700000000");
  assert.equal(requests[1].init.headers["X-Vanta-Timestamp"], "1700000001");
  assert.notEqual(requests[0].init.headers["X-Vanta-Nonce"], requests[1].init.headers["X-Vanta-Nonce"]);
  assert.notEqual(requests[0].init.headers["X-Vanta-Signature"], requests[1].init.headers["X-Vanta-Signature"]);

  const body0 = Buffer.from(requests[0].init.body);
  const body1 = Buffer.from(requests[1].init.body);
  assert.deepEqual(body0, body1, "retry preserves exact body bytes");
  assert.equal(
    body0.toString("utf8"),
    '{"order_id":"VNT-ABC123","amount_minor":1250,"currency":"GHS","customer_email":"customer@example.com","return_url":"https://vanta.example/payments/callback"}',
  );

  for (const { init } of requests) {
    const timestamp = init.headers["X-Vanta-Timestamp"];
    const nonce = init.headers["X-Vanta-Nonce"];
    const digest = crypto.createHash("sha256").update(init.body).digest("hex");
    const canonical = ["POST", "/api/gateway/v1/payment-intents", timestamp, nonce, paymentId, digest].join("\n");
    const expectedSignature = crypto.createHmac("sha256", testSecret).update(canonical, "utf8").digest("hex");
    assert.equal(init.headers["X-Vanta-Signature"], expectedSignature);
  }

  {
    let calls = 0;
    const timestamps = [];
    const fixedSecond = 1_700_000_000_000;
    const { gateway } = loadGateway({
      now: () => fixedSecond,
      fetchImpl: async (_url, init) => {
        calls += 1;
        timestamps.push(init.headers["X-Vanta-Timestamp"]);
        return response(expectedIntent);
      },
    });
    await gateway.initializeBundleUpPaymentIntent(validInput());
    await gateway.initializeBundleUpPaymentIntent(validInput());
    assert.equal(calls, 2);
    assert.deepEqual(timestamps, ["1700000000", "1700000000"], "timestamps use wall-clock seconds without artificial advancement");
  }
}

for (const disallowedUrl of [
  "http://checkout.example/pay",
  "https://evil.example/pay",
  "https://checkout.example:443/pay",
  "https://user@checkout.example/pay",
  "https://checkout.example/pay#fragment",
]) {
  const { gateway } = loadGateway({
    fetchImpl: async () => response({ ...expectedIntent, authorization_url: disallowedUrl }),
  });
  await assert.rejects(
    gateway.initializeBundleUpPaymentIntent(validInput()),
    (error) => error.name === "BundleUpGatewayUnresolvedError",
  );
}

for (const malformedBody of [
  "{",
  "null",
  "[]",
  JSON.stringify({ ...expectedIntent, reference: "different-reference" }),
  JSON.stringify({
    ...expectedIntent,
    intent_id: "a".repeat(64),
    reference: `VANTA-${"a".repeat(64)}`,
  }),
]) {
  const { gateway } = loadGateway({ fetchImpl: async () => rawResponse(malformedBody) });
  await assert.rejects(
    gateway.initializeBundleUpPaymentIntent(validInput()),
    (error) => error.name === "BundleUpGatewayUnresolvedError",
  );
}

{
  const { gateway } = loadGateway({
    fetchImpl: async () => response({
      intent_id: intentId,
      reference: `VANTA-${intentId}`,
      status: "payment_verified",
      verification: {
        status: "success",
        amount_minor: 1250,
        currency: "GHS",
      },
    }),
  });
  await assert.rejects(
    gateway.initializeBundleUpPaymentIntent(validInput()),
    (error) => error.name === "BundleUpGatewayUnresolvedError",
    "payment_verified without the specified authenticated evidence contract is not accepted",
  );
}

for (const status of [300, 301, 302, 307, 308, 408, 409, 429, 500, 502, 503, 504, 201, 202, 204]) {
  let calls = 0;
  const responseBody = status === 204 ? "" : JSON.stringify({
    intent_id: intentId,
    reference: `VANTA-${intentId}`,
    status: status === 409 ? "initialization_unknown" : "initializing",
  });
  const test = loadGateway({
    fetchImpl: async () => {
      calls += 1;
      return rawResponse(responseBody, status, status >= 300 && status < 400 ? { location: "https://evil.example" } : {});
    },
  });
  await assert.rejects(
    test.gateway.initializeBundleUpPaymentIntent(validInput()),
    (error) => error.name === "BundleUpGatewayUnresolvedError",
  );
  assert.equal(calls, 1, `HTTP ${status} is unresolved after a single request`);
}

{
  let reads = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      reads += 1;
      controller.enqueue(new Uint8Array(16_385));
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 });
  const { gateway } = loadGateway({
    fetchImpl: async () => new Response(stream, { status: 200 }),
  });
  await assert.rejects(
    gateway.initializeBundleUpPaymentIntent(validInput()),
    (error) => error.name === "BundleUpGatewayUnresolvedError",
  );
  assert.equal(reads, 1, "response reader stops at the first oversized chunk");
  assert.equal(cancelled, true, "oversized response stream is cancelled");
}

for (const status of [200, 500]) {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(16_385));
    },
  });
  const { gateway } = loadGateway({
    fetchImpl: async () => new Response(stream, { status }),
  });
  await assert.rejects(
    gateway.initializeBundleUpPaymentIntent(validInput()),
    (error) => error.name === "BundleUpGatewayUnresolvedError",
  );
}

for (const state of ["initializing", "initialization_unknown"]) {
  let calls = 0;
  const { gateway } = loadGateway({
    fetchImpl: async () => {
      calls += 1;
      return response({
        intent_id: intentId,
        reference: `VANTA-${intentId}`,
        status: state,
        error: "Payment initialization is not yet confirmed.",
      }, 409);
    },
  });
  await assert.rejects(
    gateway.initializeBundleUpPaymentIntent(validInput()),
    (error) => error.name === "BundleUpGatewayUnresolvedError" && error.gatewayState === state,
  );
  assert.equal(calls, 1, "an unresolved response never starts a second intent");
}

{
  let calls = 0;
  let timeoutCallback;
  const { gateway } = loadGateway({
    timer: (callback) => { timeoutCallback = callback; return 1; },
    clearTimer: () => {},
    fetchImpl: async (_url, init) => {
      calls += 1;
      timeoutCallback();
      assert.equal(init.signal.aborted, true, "timeout aborts the HTTP request");
      throw Object.assign(new Error("simulated timeout"), { name: "AbortError" });
    },
  });
  await assert.rejects(
    gateway.initializeBundleUpPaymentIntent(validInput()),
    (error) => error.name === "BundleUpGatewayUnresolvedError",
  );
  assert.equal(calls, 1, "a timeout is unresolved and is not retried or sent to Paystack");
}

{
  let calls = 0;
  const { gateway } = loadGateway({
    fetchImpl: async () => {
      calls += 1;
      throw new TypeError("simulated connection failure");
    },
  });
  await assert.rejects(
    gateway.initializeBundleUpPaymentIntent(validInput()),
    (error) => error.name === "BundleUpGatewayUnresolvedError",
  );
  assert.equal(calls, 1, "connection failure after dispatch does not trigger automatic retry");
}

{
  let calls = 0;
  const { gateway } = loadGateway({
    fetchImpl: async () => {
      calls += 1;
      return rawResponse("{}", 401);
    },
  });
  await assert.rejects(
    gateway.initializeBundleUpPaymentIntent(validInput()),
    (error) => error.name === "BundleUpGatewayError" && error.status === 401,
  );
  assert.equal(calls, 1, "clear authentication rejections are not treated as success");
}

{
  let calls = 0;
  const { gateway } = loadGateway({
    fetchImpl: async () => {
      calls += 1;
      return response({ status: "initialization_unknown" }, 502);
    },
  });
  await assert.rejects(
    gateway.initializeBundleUpPaymentIntent(validInput()),
    (error) => error.name === "BundleUpGatewayUnresolvedError",
  );
  assert.equal(calls, 1, "an ambiguous provider outcome is not retried");
}

{
  const gatewaySource = fs.readFileSync("lib/payments/bundleup-gateway.ts", "utf8");
  const initRoute = fs.readFileSync("app/api/payments/initialize/route.ts", "utf8");
  const webhookRoute = fs.readFileSync("app/api/payments/webhook/route.ts", "utf8");
  const walletDepositRoute = fs.readFileSync("app/api/account/wallet/deposit/route.ts", "utf8");
  assert.doesNotMatch(gatewaySource, /initializePaystack|verifyPaystack/);
  assert.match(gatewaySource, /crypto\.randomUUID/);
  assert.match(initRoute, /initializePaystack/);
  assert.match(initRoute, /initializeBundleUpGatewayAttempt/);
  assert.match(initRoute, /VANTA_CHECKOUT_PAYMENT_PROVIDER/);
  assert.match(webhookRoute, /verifyPaystack/);
  assert.match(walletDepositRoute, /initializeWalletPaystack/);
}

console.log("bundleup-gateway-client-tests: passed");
