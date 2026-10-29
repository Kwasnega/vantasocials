import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const ownerId = "10000000-0000-4000-8000-000000000001";
const otherUserId = "20000000-0000-4000-8000-000000000002";
const orderId = "30000000-0000-4000-8000-000000000003";
const orderReference = "VNT-LOCAL-001";
const sharedSecret = "local-only-integration-secret-32-bytes";
const evidenceKeyId = "local-integration-test";
const checkoutHost = "checkout.local.test";
const returnUrl = "https://vanta.local.test/payments/bundleup/return";
const publicKeyPair = crypto.generateKeyPairSync("ed25519");
const evidencePublicKey = publicKeyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
const fixedCheckoutUrl = "https://checkout.local.test/pay/disposable";

function compileModule(sourcePath, dependencies, globals = {}) {
  const source = fs.readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require(specifier) {
      if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
      return nativeRequire(specifier);
    },
    ...globals,
  }, { filename: sourcePath });
  return module.exports;
}

function amountToMinorUnits(value) {
  const normalized = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error("Invalid amount");
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function createAttemptId(sequence) {
  return `40000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function bytea(value) {
  return `\\x${Buffer.from(value).toString("hex")}`;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function verifyGatewayRequest(request, bodyBytes, gateway) {
  const timestamp = request.headers["x-vanta-timestamp"];
  const nonce = request.headers["x-vanta-nonce"];
  const idempotencyKey = request.headers["idempotency-key"];
  const suppliedSignature = request.headers["x-vanta-signature"];
  assert.equal(typeof timestamp, "string");
  assert.equal(typeof nonce, "string");
  assert.equal(typeof idempotencyKey, "string");
  assert.equal(typeof suppliedSignature, "string");
  const canonical = gateway.buildBundleUpGatewayCanonicalMessage({
    path: request.url,
    timestamp,
    nonce,
    idempotencyKey,
    bodyBytes,
  });
  const expectedSignature = crypto.createHmac("sha256", sharedSecret)
    .update(canonical, "utf8")
    .digest("hex");
  assert.equal(suppliedSignature, expectedSignature, "VANTA initialization/reconciliation request HMAC");
}

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function runScenario(scenario, sequence) {
  const paymentId = createAttemptId(sequence);
  const gatewayConfig = {
    VANTA_BUNDLEUP_GATEWAY_ENABLED: "true",
    VANTA_BUNDLEUP_GATEWAY_BASE_URL: "https://gateway.local.test",
    VANTA_BUNDLEUP_GATEWAY_ALLOWED_HOSTS: "gateway.local.test",
    VANTA_BUNDLEUP_GATEWAY_SHARED_SECRET: sharedSecret,
    VANTA_BUNDLEUP_GATEWAY_EVIDENCE_PUBLIC_KEYS: JSON.stringify({
      [evidenceKeyId]: evidencePublicKey,
    }),
    VANTA_BUNDLEUP_GATEWAY_CHECKOUT_HOSTS: checkoutHost,
    VANTA_BUNDLEUP_GATEWAY_RETURN_URL: returnUrl,
  };
  const database = {
    order: {
      id: orderId,
      user_id: ownerId,
      public_order_id: orderReference,
      total: "12.50",
      currency: "GHS",
      status: "PENDING_PAYMENT",
      payment_status: "UNPAID",
      fulfillment_status: "NOT_STARTED",
    },
    payment: {
      id: paymentId,
      order_id: orderId,
      user_id: ownerId,
      provider: "bundleup_gateway",
      reference: `VANTA-GW-${paymentId.replaceAll("-", "")}`,
      amount: "12.50",
      currency: "GHS",
      status: "PENDING",
      gateway_initialization_status: "RESERVED",
      gateway_order_reference: orderReference,
      gateway_customer_email: "local-test@example.invalid",
      gateway_return_url: returnUrl,
      gateway_intent_id: null,
      gateway_reference: null,
      gateway_authorization_url: null,
    },
    requests: new Map(),
    evidence: null,
    referenceClaim: null,
    rpcCalls: [],
    queries: [],
  };
  let activeUser = { id: ownerId };
  const mode = scenario;

  const admin = {
    from(table) {
      const filters = [];
      const query = {
        select() { return this; },
        eq(column, value) { filters.push([column, value]); return this; },
        maybeSingle() {
          database.queries.push({ table, filters: [...filters] });
          const matches = (row) => row && filters.every(([column, value]) => row[column] === value);
          let row = null;
          if (table === "payments" && matches(database.payment)) row = database.payment;
          if (table === "orders" && matches(database.order)) row = database.order;
          if (table === "bundleup_gateway_payment_evidence"
              && matches(database.evidence)) row = database.evidence;
          if (table === "bundleup_gateway_reconciliation_requests") {
            row = [...database.requests.values()].find(matches) ?? null;
          }
          if (table === "payment_provider_reference_claims") {
            row = database.referenceClaim && filters.every(([column, value]) =>
              database.referenceClaim[column] === value) ? database.referenceClaim : null;
          }
          const result = { data: row ? structuredClone(row) : null, error: null };
          return {
            overrideTypes() { return this; },
            then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
          };
        },
      };
      return query;
    },
    async rpc(name, args) {
      database.rpcCalls.push({ name, args: structuredClone(args) });
      if (name === "reserve_bundleup_gateway_payment_attempt") {
        if (
          args.p_order_id !== orderId
          || args.p_expected_user_id !== database.order.user_id
          || args.p_return_url !== returnUrl
        ) return { data: null, error: new Error("ORDER_NOT_AVAILABLE") };
        return { data: [structuredClone(database.payment)], error: null };
      }
      if (name === "claim_bundleup_gateway_payment_initialization") {
        if (
          args.p_payment_id !== paymentId
          || args.p_expected_user_id !== ownerId
          || database.payment.gateway_initialization_status !== "RESERVED"
        ) return { data: false, error: null };
        database.payment.gateway_initialization_status = "INITIALIZING";
        return { data: true, error: null };
      }
      if (name === "complete_bundleup_gateway_payment_initialization") {
        if (database.payment.gateway_initialization_status !== "INITIALIZING") {
          return { data: false, error: null };
        }
        database.payment.gateway_initialization_status = "INITIALIZED";
        database.payment.gateway_intent_id = args.p_intent_id;
        database.payment.gateway_reference = args.p_gateway_reference;
        database.payment.gateway_authorization_url = args.p_authorization_url;
        return { data: true, error: null };
      }
      if (name === "create_bundleup_gateway_reconciliation_request") {
        if (
          args.p_payment_id !== paymentId
          || args.p_expected_user_id !== ownerId
          || database.payment.user_id !== args.p_expected_user_id
        ) return { data: null, error: new Error("PAYMENT_NOT_FOUND") };
        database.requests.set(args.p_request_id, {
          id: args.p_request_id,
          payment_id: paymentId,
          order_id: orderId,
          user_id: ownerId,
          tenant_id: "vanta",
          order_reference: orderReference,
          amount_minor: 1250,
          currency: "GHS",
          request_nonce: args.p_request_nonce,
          state: "PENDING",
          response_outcome: null,
          response_payload: null,
          response_signature: null,
        });
        return { data: true, error: null };
      }
      if (name === "settle_bundleup_gateway_order_payment") {
        const request = database.requests.get(args.p_request_id);
        const payloadBytes = Buffer.from(args.p_signed_payload.slice(2), "hex");
        const signatureBytes = Buffer.from(args.p_signature.slice(2), "hex");
        const payload = JSON.parse(payloadBytes.toString("utf8"));
        const signatureValid = crypto.verify(
          null,
          payloadBytes,
          publicKeyPair.publicKey,
          signatureBytes,
        );
        const expectedIntent = crypto.createHash("sha256")
          .update(`vanta\0idempotency:${paymentId}`, "utf8")
          .digest("hex");
        if (
          !signatureValid
          || !request
          || args.p_expected_user_id !== ownerId
          || payload.payment_id !== paymentId
          || payload.tenant_id !== "vanta"
          || payload.order_reference !== orderReference
          || payload.request_nonce !== request.request_nonce
          || payload.intent_id !== expectedIntent
          || payload.reference !== `VANTA-${expectedIntent}`
          || payload.amount_minor !== 1250
          || payload.currency !== "GHS"
          || database.payment.status !== "PENDING"
          || database.order.payment_status !== "UNPAID"
        ) return { data: null, error: new Error("MOCK_SETTLEMENT_GUARD_REJECTED") };

        database.payment.status = "PAID";
        database.order.payment_status = "PAID";
        database.evidence = {
          payment_id: paymentId,
          request_id: args.p_request_id,
          tenant_id: "vanta",
          order_reference: orderReference,
          intent_id: payload.intent_id,
          provider: "paystack",
          provider_reference: payload.reference,
          amount_minor: payload.amount_minor,
          currency: payload.currency,
          provider_status: payload.provider_status,
          verified_at: payload.verified_at,
          transaction_id: payload.transaction_id,
          request_nonce: request.request_nonce,
          signed_payload: bytea(payloadBytes),
          signature: bytea(signatureBytes),
        };
        request.state = "CONSUMED";
        request.response_outcome = "payment_verified";
        request.response_payload = bytea(payloadBytes);
        request.response_signature = bytea(signatureBytes);
        database.referenceClaim = {
          provider: "paystack",
          actual_provider_reference: payload.reference,
          payment_id: paymentId,
        };
        return {
          data: [{
            payment_id: paymentId,
            order_id: orderId,
            settled: true,
            already_settled: false,
          }],
          error: null,
        };
      }
      if (name === "record_bundleup_gateway_reconciliation_observation") {
        const request = database.requests.get(args.p_request_id);
        if (!request) return { data: null, error: new Error("REQUEST_NOT_FOUND") };
        request.state = "OBSERVED";
        request.response_outcome = args.p_outcome;
        request.response_payload = args.p_signed_payload;
        request.response_signature = args.p_signature;
        return { data: "OBSERVED", error: null };
      }
      throw new Error(`Unexpected mock RPC: ${name}`);
    },
  };

  let gateway;
  const gatewayRequire = {
    "server-only": {},
    "./paystack": { amountToMinorUnits },
  };
  const gatewaySource = fs.readFileSync("lib/payments/bundleup-gateway.ts", "utf8");
  const gatewayCompiled = ts.transpileModule(gatewaySource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const gatewayModule = { exports: {} };
  const server = http.createServer(async (request, response) => {
    server.requestCount += 1;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bodyBytes = Buffer.concat(chunks);
    try {
      verifyGatewayRequest(request, bodyBytes, gateway);
      assert.equal(request.headers["idempotency-key"], paymentId);
      const body = JSON.parse(bodyBytes.toString("utf8"));
      if (request.url === "/api/gateway/v1/payment-intents") {
        server.initializationCalls += 1;
        assert.deepEqual(body, {
          order_id: orderReference,
          amount_minor: 1250,
          currency: "GHS",
          customer_email: "local-test@example.invalid",
          return_url: returnUrl,
        });
        const callbackUrl = new URL(body.return_url);
        assert.equal(callbackUrl.searchParams.has("payment_id"), false);
        callbackUrl.searchParams.set("payment_id", request.headers["idempotency-key"]);
        server.callbackUrl = callbackUrl.toString();
        const intentId = gateway.deriveBundleUpGatewayIntentId(paymentId);
        sendJson(response, 200, {
          intent_id: intentId,
          reference: `VANTA-${intentId}`,
          authorization_url: fixedCheckoutUrl,
          status: "initialized",
          idempotent: false,
        });
        return;
      }
      assert.equal(request.url, "/api/gateway/v1/payment-intents/reconcile");
      server.reconciliationCalls += 1;
      assert.deepEqual(body, {
        tenant_id: "vanta",
        payment_id: paymentId,
        order_reference: orderReference,
        amount_minor: 1250,
        currency: "GHS",
        intent_id: database.payment.gateway_intent_id,
      });
      let payload = {
        version: 1,
        key_id: evidenceKeyId,
        tenant_id: "vanta",
        payment_id: paymentId,
        order_reference: orderReference,
        intent_id: database.payment.gateway_intent_id,
        request_nonce: request.headers["x-vanta-nonce"],
        issued_at: new Date().toISOString(),
        outcome: "payment_verified",
        provider: "paystack",
        reference: database.payment.gateway_reference,
        amount_minor: 1250,
        currency: "GHS",
        provider_status: "success",
        verified_at: new Date(Date.now() - 1000).toISOString(),
        transaction_id: `local-tx-${sequence}`,
      };
      if (mode === "amount-mismatch") payload.amount_minor = 1251;
      if (mode === "expired") {
        payload.issued_at = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        payload.verified_at = new Date(Date.now() - 10 * 60 * 1000 - 1000).toISOString();
      }
      const signedPayloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
      const signatureBytes = crypto.sign(null, signedPayloadBytes, publicKeyPair.privateKey);
      let envelopePayloadBytes = signedPayloadBytes;
      let envelopeSignatureBytes = signatureBytes;
      if (mode === "tampered-payload") {
        envelopePayloadBytes = Buffer.from(signedPayloadBytes);
        envelopePayloadBytes[envelopePayloadBytes.length - 2] ^= 1;
      }
      if (mode === "tampered-signature") {
        envelopeSignatureBytes = Buffer.from(signatureBytes);
        envelopeSignatureBytes[0] ^= 1;
      }
      sendJson(response, 200, {
        payload: envelopePayloadBytes.toString("base64url"),
        signature: envelopeSignatureBytes.toString("base64url"),
      });
    } catch (error) {
      sendJson(response, 500, { error: "local test mock rejected request" });
      server.mockError = error;
    }
  });
  server.requestCount = 0;
  server.initializationCalls = 0;
  server.reconciliationCalls = 0;
  const port = await listen(server);
  const testFetch = async (url, init) => {
    const parsedUrl = new URL(url);
    assert.equal(parsedUrl.hostname, "gateway.local.test");
    return fetch(`http://127.0.0.1:${port}${parsedUrl.pathname}`, init);
  };

  try {
    const testEnv = {
      ...gatewayConfig,
      VANTA_BUNDLEUP_GATEWAY_BASE_URL: "https://gateway.local.test",
    };
    vm.runInNewContext(gatewayCompiled, {
      module: gatewayModule,
      exports: gatewayModule.exports,
      process: { env: testEnv },
      Date,
      Buffer,
      URL,
      Response,
      TextDecoder,
      AbortController,
      Uint8Array,
      setTimeout,
      clearTimeout,
      fetch: testFetch,
      require(specifier) {
        if (Object.hasOwn(gatewayRequire, specifier)) return gatewayRequire[specifier];
        return nativeRequire(specifier);
      },
    }, { filename: "bundleup-gateway.ts" });
    gateway = gatewayModule.exports;
    assert.equal(testEnv.VANTA_BUNDLEUP_GATEWAY_ENABLED, "true");

    const attemptModule = compileModule("lib/payments/bundleup-gateway-attempt.ts", {
      "server-only": {},
      "../supabase/server": { createSupabaseAdminClient: () => admin },
      "./paystack": { amountToMinorUnits },
      "./bundleup-gateway": gateway,
    }, {
      process: { env: testEnv },
      URL,
      Buffer,
      Uint8Array,
      BigInt,
      Number,
      Set,
    });

    const initialized = await attemptModule.initializeBundleUpGatewayAttempt({
      orderId,
      userId: ownerId,
    });
    assert.equal(initialized.status, "initialized");
    assert.equal(initialized.paymentId, paymentId);
    assert.equal(initialized.authorizationUrl, fixedCheckoutUrl);
    assert.equal(database.payment.gateway_initialization_status, "INITIALIZED");
    assert.equal(database.payment.gateway_intent_id, gateway.deriveBundleUpGatewayIntentId(paymentId));

    const browserReturn = new URL(server.callbackUrl);
    assert.equal(browserReturn.pathname, "/payments/bundleup/return");
    assert.equal(browserReturn.searchParams.get("payment_id"), paymentId);
    assert.equal(browserReturn.searchParams.getAll("payment_id").length, 1);
    assert.equal(browserReturn.searchParams.get("payment_id"), initialized.paymentId);

    const routeModule = compileModule("app/api/payments/bundleup/reconcile/route.ts", {
      "next/server": {
        after(fn) { Promise.resolve().then(fn).catch(() => {}); },
        NextResponse: { json: (body, init = {}) => Response.json(body, init) },
      },
      "../../../../../lib/supabase/server": {
        getCurrentUser: async () => activeUser,
        createSupabaseAdminClient: () => admin,
      },
      "../../../../../lib/payments/bundleup-gateway-attempt": attemptModule,
      "../../../../../lib/security/rate-limit": {
        clientIp: () => "127.0.0.1",
        consumeRateLimits: async () => ({ allowed: true, retryAfterSeconds: 1 }),
        limiterUnavailable: () => Response.json({ error: "rate limiter unavailable" }, { status: 503 }),
        rateLimited: () => Response.json({ error: "rate limited" }, { status: 429 }),
        rulesFor: (...args) => args,
      },
      "../../../../../lib/fulfillment/dispatch-paid-order": {
        dispatchPaidOrder: async () => {
          database.dispatchCalls = (database.dispatchCalls ?? 0) + 1;
        },
      },
    }, {
      process: { env: testEnv },
      Request,
      Response,
    });
    const reconcileRequest = () => routeModule.POST(new Request(
      "https://vanta.local.test/api/payments/bundleup/reconcile",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payment_id: browserReturn.searchParams.get("payment_id") }),
      },
    ));

    if (scenario === "successful") {
      const requestCountBeforeUnauthorized = server.requestCount ?? 0;
      activeUser = { id: otherUserId };
      const unauthorizedOwnerResponse = await reconcileRequest();
      assert.equal(unauthorizedOwnerResponse.status, 404);
      assert.equal(database.rpcCalls.filter(({ name }) => name === "settle_bundleup_gateway_order_payment").length, 0);
      assert.equal(server.requestCount ?? 0, requestCountBeforeUnauthorized);
      activeUser = { id: ownerId };
    }

    const response = await reconcileRequest();
    const responseBody = await response.json();
    if (scenario === "successful") {
      assert.equal(response.status, 200);
      assert.deepEqual(
        responseBody,
        { status: "confirmed", confirmed: true, retryable: false },
        JSON.stringify({
          rpcNames: database.rpcCalls.map(({ name }) => name),
          mockFailure: server.mockError?.message ?? null,
          requestCount: server.requestCount,
        }),
      );
      assert.equal(database.payment.status, "PAID");
      assert.equal(database.order.payment_status, "PAID");
      assert.equal(database.order.fulfillment_status, "NOT_STARTED");
      assert.equal(database.rpcCalls.filter(({ name }) => name === "settle_bundleup_gateway_order_payment").length, 1);
      assert.equal(database.evidence.tenant_id, "vanta");
      assert.equal(database.requests.get(database.evidence.request_id).state, "CONSUMED");
      const fulfillmentCron = fs.readFileSync("app/api/internal/fulfillment/cron/route.ts", "utf8");
      assert.match(fulfillmentCron, /\.eq\("payment_status", "PAID"\)/);
      assert.match(fulfillmentCron, /\.in\("fulfillment_status", \["NOT_STARTED"/);

      const rpcCountBeforeReplay = database.rpcCalls.length;
      const replayResponse = await reconcileRequest();
      assert.deepEqual(await replayResponse.json(), {
        status: "confirmed",
        confirmed: true,
        retryable: false,
      });
      assert.equal(database.rpcCalls.length, rpcCountBeforeReplay);
    } else {
      assert.equal(response.status, 200);
      assert.equal(responseBody.confirmed, false);
      assert.equal(database.payment.status, "PENDING");
      assert.equal(database.order.payment_status, "UNPAID");
      assert.equal(database.rpcCalls.some(({ name }) =>
        name === "settle_bundleup_gateway_order_payment"), false);
    }
    if (server.mockError) throw server.mockError;
    return {
      scenario,
      initializationCalls: server.initializationCalls,
      reconciliationCalls: server.reconciliationCalls,
      response: responseBody.status,
      settlementCalls: database.rpcCalls.filter(({ name }) =>
        name === "settle_bundleup_gateway_order_payment").length,
    };
  } finally {
    await close(server);
  }
}

const results = [];
for (const [scenario, sequence] of [
  ["successful", 1],
  ["tampered-signature", 2],
  ["tampered-payload", 3],
  ["amount-mismatch", 4],
  ["expired", 5],
]) {
  results.push(await runScenario(scenario, sequence));
}

console.log(JSON.stringify({
  test: "bundleup-gateway-local-integration-tests",
  passed: true,
  databaseSettlement: "mocked boundary; no database connection",
  scenarios: results,
}, null, 2));
