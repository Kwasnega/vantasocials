import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const testSecret = "stage-two-s-test-only-shared-secret-value";
const paymentId = "00000000-0000-4000-8000-000000000001";
const orderReference = "VNT-ABC123";
const intentId = crypto.createHash("sha256")
  .update(`vanta\0idempotency:${paymentId}`, "utf8")
  .digest("hex");
const providerReference = `VANTA-${intentId}`;
const fixedNow = Date.parse("2026-10-26T13:00:00.000Z");
const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const trustedKeys = JSON.stringify({ "test-key-1": publicKeyPem });
const validTerms = {
  paymentId,
  orderReference,
  amountMinor: 1250,
  currency: "GHS",
  intentId: null,
  providerReference: null,
};

function loadGateway({
  env = {},
  now = () => fixedNow,
  fetchImpl,
  timer = setTimeout,
  clearTimer = clearTimeout,
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
    VANTA_BUNDLEUP_GATEWAY_EVIDENCE_PUBLIC_KEYS: trustedKeys,
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
    fetch: fetchImpl ?? (async () => new Response("{}", { status: 503 })),
    require(specifier) {
      if (specifier === "server-only") return {};
      if (specifier === "./paystack") {
        return {
          amountToMinorUnits(value) {
            const normalized = String(value).trim();
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

function makePayload(overrides = {}) {
  return {
    version: 1,
    key_id: "test-key-1",
    tenant_id: "vanta",
    payment_id: paymentId,
    order_reference: orderReference,
    intent_id: intentId,
    request_nonce: "placeholder-nonce-000000000000",
    issued_at: "2026-10-26T13:00:00.000Z",
    outcome: "payment_verified",
    provider: "paystack",
    reference: providerReference,
    amount_minor: 1250,
    currency: "GHS",
    provider_status: "success",
    verified_at: "2026-10-26T12:59:59.000Z",
    transaction_id: "123456789",
    ...overrides,
  };
}

function signedEnvelope(payload, signingKey = privateKey) {
  const payloadBytes = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload), "utf8");
  return JSON.stringify({
    payload: payloadBytes.toString("base64url"),
    signature: crypto.sign(null, payloadBytes, signingKey).toString("base64url"),
  });
}

function validEnvelopeForRequest(init, payloadOverrides = {}) {
  const parsedBody = JSON.parse(Buffer.from(init.body).toString("utf8"));
  return signedEnvelope(makePayload({
    payment_id: parsedBody.payment_id,
    order_reference: parsedBody.order_reference,
    amount_minor: parsedBody.amount_minor,
    currency: parsedBody.currency,
    intent_id: parsedBody.intent_id ?? intentId,
    request_nonce: init.headers["X-Vanta-Nonce"],
    ...payloadOverrides,
  }));
}

function envelopeResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function runClient({ fetchResponse, env, now, terms = validTerms }) {
  const calls = [];
  const persistedRequests = [];
  const { gateway, env: actualEnv } = loadGateway({
    env,
    now,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return fetchResponse(url, init, calls.length);
    },
  });
  const persistRequest = async (request) => {
    persistedRequests.push({
      ...request,
      requestBody: Buffer.from(request.requestBody),
    });
  };
  const result = await gateway.reconcileBundleUpPaymentIntent(terms, persistRequest);
  return { result, calls, env: actualEnv, gateway, persistRequest, persistedRequests };
}

{
  const test = await runClient({
    fetchResponse: async (_url, init) => envelopeResponse(validEnvelopeForRequest(init)),
  });
  assert.equal(test.result.status, "payment_verified");
  assert.deepEqual(
    { ...test.result.evidence },
    {
      intentId,
      provider: "paystack",
      reference: providerReference,
      amountMinor: 1250,
      currency: "GHS",
      providerStatus: "success",
      verifiedAt: "2026-10-26T12:59:59.000Z",
      transactionId: "123456789",
    },
  );
  assert.equal(test.calls.length, 1);
  assert.equal(test.persistedRequests.length, 1, "request is persisted before HTTP");
  const [{ url, init }] = test.calls;
  assert.equal(url, "https://gateway.example/api/gateway/v1/payment-intents/reconcile");
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "manual");
  assert.equal(init.headers["Idempotency-Key"], paymentId);
  assert.equal(init.headers["content-type"], "application/json");
  const requestBody = Buffer.from(init.body);
  assert.equal(
    requestBody.toString("utf8"),
    `{"tenant_id":"vanta","payment_id":"${paymentId}","order_reference":"${orderReference}","amount_minor":1250,"currency":"GHS"}`,
  );
  const canonical = [
    "POST",
    "/api/gateway/v1/payment-intents/reconcile",
    init.headers["X-Vanta-Timestamp"],
    init.headers["X-Vanta-Nonce"],
    paymentId,
    crypto.createHash("sha256").update(requestBody).digest("hex"),
  ].join("\n");
  assert.equal(
    init.headers["X-Vanta-Signature"],
    crypto.createHmac("sha256", testSecret).update(canonical, "utf8").digest("hex"),
  );
  assert.deepEqual(Buffer.from(test.persistedRequests[0].requestBody), requestBody);
  assert.equal(test.persistedRequests[0].requestNonce, init.headers["X-Vanta-Nonce"]);
  assert.equal(test.persistedRequests[0].requestTimestamp, init.headers["X-Vanta-Timestamp"]);
  assert.equal(test.result.proof.signatureBytes.length, 64);
  assert.deepEqual(
    Buffer.from(test.result.proof.payloadBytes),
    Buffer.from(JSON.parse(init.body ? validEnvelopeForRequest(init) : "{}").payload, "base64url"),
  );
}

{
  const { privateKey: nextPrivateKey, publicKey: nextPublicKey } = crypto.generateKeyPairSync("ed25519");
  const nextPublicPem = nextPublicKey.export({ type: "spki", format: "pem" }).toString();
  const test = await runClient({
    env: {
      VANTA_BUNDLEUP_GATEWAY_EVIDENCE_PUBLIC_KEYS: JSON.stringify({
        "test-key-1": publicKeyPem,
        "test-key-2": nextPublicPem,
      }),
    },
    terms: { ...validTerms, intentId, providerReference },
    fetchResponse: async (_url, init) => envelopeResponse(signedEnvelope(
      makePayload({
        key_id: "test-key-2",
        intent_id: intentId,
        request_nonce: init.headers["X-Vanta-Nonce"],
      }),
      nextPrivateKey,
    )),
  });
  assert.equal(test.result.status, "payment_verified", "overlapping pinned keys support rotation");
  assert.equal(JSON.parse(Buffer.from(test.calls[0].init.body).toString("utf8")).intent_id, intentId);
}

for (const badEnvelope of [
  (init) => {
    const envelope = JSON.parse(validEnvelopeForRequest(init));
    envelope.signature = `${envelope.signature.slice(0, -1)}${envelope.signature.endsWith("A") ? "B" : "A"}`;
    return JSON.stringify(envelope);
  },
  (init) => {
    const envelope = JSON.parse(validEnvelopeForRequest(init));
    const payloadBytes = Buffer.from(envelope.payload, "base64url");
    payloadBytes[payloadBytes.length - 2] ^= 1;
    envelope.payload = payloadBytes.toString("base64url");
    return JSON.stringify(envelope);
  },
  (init) => {
    const envelope = JSON.parse(validEnvelopeForRequest(init));
    envelope.payload += "=";
    return JSON.stringify(envelope);
  },
  (init) => {
    const envelope = JSON.parse(validEnvelopeForRequest(init));
    envelope.signature += "=";
    return JSON.stringify(envelope);
  },
  (init) => validEnvelopeForRequest(init, { key_id: "unknown-key" }),
  () => JSON.stringify({ payload: "%%%", signature: "%%%" }),
  () => signedEnvelope(Buffer.from("{")),
  () => JSON.stringify({
    payload: Buffer.from(JSON.stringify(makePayload())).toString("base64url"),
    signature: Buffer.alloc(63).toString("base64url"),
  }),
]) {
  const test = await runClient({
    fetchResponse: async (_url, init) => envelopeResponse(badEnvelope(init)),
  });
  assert.equal(test.result.status, "unresolved");
}

for (const env of [
  { VANTA_BUNDLEUP_GATEWAY_EVIDENCE_PUBLIC_KEYS: undefined },
  { VANTA_BUNDLEUP_GATEWAY_EVIDENCE_PUBLIC_KEYS: "not-json" },
  { VANTA_BUNDLEUP_GATEWAY_EVIDENCE_PUBLIC_KEYS: JSON.stringify({ "bad key id": publicKeyPem }) },
  { VANTA_BUNDLEUP_GATEWAY_EVIDENCE_PUBLIC_KEYS: JSON.stringify({ "wrong-type": "not a PEM key" }) },
]) {
  const test = await runClient({
    env,
    fetchResponse: async (_url, init) => envelopeResponse(validEnvelopeForRequest(init)),
  });
  assert.equal(test.result.status, "unresolved");
}

for (const issuedAt of [
  "2026-10-26T12:54:59.999Z",
  "2026-10-26T13:05:00.001Z",
  "2026-02-30T13:00:00.000Z",
]) {
  const test = await runClient({
    fetchResponse: async (_url, init) => envelopeResponse(validEnvelopeForRequest(init, { issued_at: issuedAt })),
  });
  assert.equal(test.result.status, "unresolved", `invalid issuance time rejected: ${issuedAt}`);
}

{
  let priorEnvelope;
  const test = await runClient({
    fetchResponse: async (_url, init, callCount) => {
      if (callCount === 1) {
        priorEnvelope = validEnvelopeForRequest(init);
        return envelopeResponse(priorEnvelope);
      }
      return envelopeResponse(priorEnvelope);
    },
  });
  const first = test.result;
  const second = await test.gateway.reconcileBundleUpPaymentIntent(validTerms, test.persistRequest);
  assert.equal(first.status, "payment_verified");
  assert.equal(second.status, "unresolved", "a prior response nonce cannot satisfy a fresh request");
  assert.equal(test.calls.length, 2);
  assert.notEqual(
    test.calls[0].init.headers["X-Vanta-Nonce"],
    test.calls[1].init.headers["X-Vanta-Nonce"],
  );
  assert.equal(test.calls[0].init.headers["Idempotency-Key"], test.calls[1].init.headers["Idempotency-Key"]);
  assert.deepEqual(Buffer.from(test.calls[0].init.body), Buffer.from(test.calls[1].init.body));
}

for (const [label, overrides] of [
  ["tenant", { tenant_id: "other" }],
  ["payment", { payment_id: "00000000-0000-4000-8000-000000000002" }],
  ["order", { order_reference: "VNT-OTHER" }],
  ["intent", { intent_id: "b".repeat(64) }],
  ["reference", { reference: `VANTA-${"b".repeat(64)}` }],
  ["amount", { amount_minor: 1251 }],
  ["currency", { currency: "USD" }],
  ["provider", { provider: "other" }],
  ["provider status", { provider_status: "pending" }],
  ["verification time", { verified_at: "not-a-timestamp" }],
  ["verification time after issue", { verified_at: "2026-10-26T13:00:00.001Z" }],
  ["transaction id", { transaction_id: 123456789 }],
]) {
  const test = await runClient({
    terms: { ...validTerms, intentId, providerReference },
    fetchResponse: async (_url, init) => envelopeResponse(validEnvelopeForRequest(init, overrides)),
  });
  assert.equal(test.result.status, "unresolved", `${label} mismatch rejected`);
}

for (const [outcome, providerStatus] of [
  ["initialized", "ongoing"],
  ["pending", "pending"],
  ["failed", "failed"],
]) {
  const test = await runClient({
    fetchResponse: async (_url, init) => envelopeResponse(validEnvelopeForRequest(init, {
      outcome,
      provider_status: providerStatus,
    })),
  });
  assert.equal(test.result.status, outcome);
  assert.equal(test.result.observation.providerStatus, providerStatus);
}

for (const payload of [
  {
    version: 1,
    key_id: "test-key-1",
    tenant_id: "vanta",
    payment_id: paymentId,
    order_reference: orderReference,
    intent_id: intentId,
    request_nonce: "placeholder-nonce-000000000000",
    issued_at: "2026-10-26T13:00:00.000Z",
    outcome: "unresolved",
    reason: "provider_unavailable",
  },
  {
    version: 1,
    key_id: "test-key-1",
    tenant_id: "vanta",
    payment_id: paymentId,
    order_reference: orderReference,
    intent_id: null,
    request_nonce: "placeholder-nonce-000000000000",
    issued_at: "2026-10-26T13:00:00.000Z",
    outcome: "not_found",
    reason: "intent_not_found",
  },
]) {
  const test = await runClient({
    fetchResponse: async (_url, init) => {
      const requestNonce = init.headers["X-Vanta-Nonce"];
      return envelopeResponse(signedEnvelope({ ...payload, request_nonce: requestNonce }));
    },
  });
  assert.equal(test.result.status, payload.outcome);
}

for (const status of [400, 401, 409, 413, 503]) {
  const test = await runClient({
    fetchResponse: async (_url, init) => envelopeResponse(validEnvelopeForRequest(init), status),
  });
  assert.equal(test.result.status, "unresolved", `HTTP ${status} is unsigned and not evidence`);
}

{
  let timeoutCallback;
  const { gateway } = loadGateway({
    timer: (callback) => { timeoutCallback = callback; return 1; },
    clearTimer: () => {},
    fetchImpl: async (_url, init) => {
      timeoutCallback();
      assert.equal(init.signal.aborted, true);
      throw Object.assign(new Error("simulated timeout"), { name: "AbortError" });
    },
  });
  assert.equal((await gateway.reconcileBundleUpPaymentIntent(validTerms, async () => {})).status, "unresolved");
}

{
  const test = await runClient({
    fetchResponse: async () => envelopeResponse("{", 200),
  });
  assert.equal(test.result.status, "unresolved");
}

{
  const test = loadGateway({
    env: { VANTA_BUNDLEUP_GATEWAY_ENABLED: undefined },
    fetchImpl: async () => { throw new Error("network must not be called"); },
  });
  await assert.rejects(
    test.gateway.reconcileBundleUpPaymentIntent(validTerms, async () => {}),
    (error) => error.code === "DISABLED",
  );
}

function loadAttempt({
  enabled = "true",
  row,
  lookupError = null,
  reconciliationResult = { status: "unresolved", reason: "test-observation" },
  rpcResponses = {},
  rpcErrors = {},
  rows = {},
  storedProof = null,
} = {}) {
  const source = fs.readFileSync("lib/payments/bundleup-gateway-attempt.ts", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const state = {
    queries: [],
    reconciledTerms: [],
    rpcCalls: [],
    tableReads: {},
  };
  const admin = {
    async rpc(name, args) {
      state.rpcCalls.push({ name, args });
      return {
        data: rpcResponses[name] ?? args.p_request_id ?? true,
        error: rpcErrors[name] ?? null,
      };
    },
    from(table) {
      state.queries.push({ table, filters: [] });
      const query = state.queries[state.queries.length - 1];
      const readIndex = state.tableReads[table] ?? 0;
      state.tableReads[table] = readIndex + 1;
      const configuredRows = rows[table];
      const selectedRow = Array.isArray(configuredRows)
        ? configuredRows[readIndex]
        : configuredRows ?? (table === "payments" ? row : null);
      const result = {
        data: selectedRow ?? null,
        error: table === "payments" && readIndex === 0 ? lookupError : null,
      };
      return {
        select(fields) { query.fields = fields; return this; },
        eq(column, value) { query.filters.push([column, value]); return this; },
        maybeSingle() {
          return {
            async overrideTypes() { return result; },
            then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
          };
        },
      };
    },
  };
  class TestGatewayError extends Error {
    constructor(message, code) { super(message); this.code = code; }
  }
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    process: { env: { VANTA_BUNDLEUP_GATEWAY_ENABLED: enabled } },
    URL,
    BigInt,
    Number,
    Set,
    Buffer,
    require(specifier) {
      if (specifier === "server-only") return {};
      if (specifier === "../supabase/server") return { createSupabaseAdminClient: () => admin };
      if (specifier === "./paystack") {
        return {
          amountToMinorUnits(value) {
            const [whole, fraction = ""] = String(value).split(".");
            return BigInt(whole) * 100n + BigInt((fraction ?? "").padEnd(2, "0"));
          },
        };
      }
      if (specifier === "./bundleup-gateway") {
        return {
          BundleUpGatewayError: TestGatewayError,
          BundleUpGatewayUnresolvedError: class extends TestGatewayError {},
          deriveBundleUpGatewayIntentId(value) {
            return crypto.createHash("sha256")
              .update(`vanta\0idempotency:${String(value).toLowerCase()}`, "utf8")
              .digest("hex");
          },
          async initializeBundleUpPaymentIntent() {
            throw new Error("reconciliation must never initialize");
          },
          async reconcileBundleUpPaymentIntent(terms, persistRequest) {
            state.reconciledTerms.push(terms);
            const requestProof = reconciliationResult.proof;
            await persistRequest({
              requestId: requestProof?.requestId ?? "00000000-0000-4000-8000-000000000002",
              paymentId: terms.paymentId,
              requestNonce: requestProof?.requestNonce ?? "mock-nonce-000000000000",
              requestTimestamp: "1793019600",
              requestBody: Buffer.from(JSON.stringify({
                tenant_id: "vanta",
                payment_id: terms.paymentId,
                order_reference: terms.orderReference,
                amount_minor: terms.amountMinor,
                currency: terms.currency,
              })),
            });
            return reconciliationResult;
          },
          verifyStoredBundleUpGatewayEvidence(input) {
            if (!storedProof) throw new Error("No stored proof configured.");
            return {
              ...storedProof,
              requestId: input.requestId,
              requestNonce: input.requestNonce,
              payloadBytes: input.payloadBytes,
              signatureBytes: input.signatureBytes,
            };
          },
        };
      }
      throw new Error(`Unexpected import: ${specifier}`);
    },
  }, { filename: "bundleup-gateway-attempt.js" });
  return { reconcile: module.exports.reconcileBundleUpGatewayAttempt, state };
}

const persistedAttempt = {
  id: paymentId,
  order_id: "order-database-id",
  user_id: "user-1",
  provider: "bundleup_gateway",
  amount: "12.50",
  currency: "GHS",
  status: "PENDING",
  gateway_initialization_status: "INITIALIZATION_UNKNOWN",
  gateway_order_reference: orderReference,
  gateway_intent_id: null,
  gateway_reference: null,
};

{
  const test = loadAttempt({ row: persistedAttempt });
  const result = await test.reconcile({ paymentId, userId: "user-1" });
  assert.equal(result.status, "unresolved");
  assert.equal(test.state.queries[0].table, "payments");
  assert.deepEqual(test.state.queries[0].filters, [
    ["id", paymentId],
    ["user_id", "user-1"],
    ["provider", "bundleup_gateway"],
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(test.state.reconciledTerms)), [{
    paymentId,
    orderReference,
    amountMinor: 1250,
    currency: "GHS",
    intentId: null,
    providerReference: null,
  }]);
}

function makeVerifiedProof() {
  const requestId = "00000000-0000-4000-8000-000000000002";
  const requestNonce = "mock-nonce-000000000000";
  const payloadBytes = Buffer.from("exact signed payload bytes");
  const signatureBytes = Buffer.alloc(64, 7);
  return {
    requestId,
    requestNonce,
    payloadBytes,
    signatureBytes,
    keyId: "test-key-1",
    issuedAt: "2026-10-26T13:00:00.000Z",
    claims: {
      version: 1,
      tenantId: "vanta",
      paymentId,
      orderReference,
      intentId,
      outcome: "payment_verified",
      provider: "paystack",
      reference: providerReference,
      amountMinor: 1250,
      currency: "GHS",
      providerStatus: "success",
      verifiedAt: "2026-10-26T12:59:30.000Z",
      transactionId: "tx-123",
    },
  };
}

{
  const proof = makeVerifiedProof();
  const test = loadAttempt({
    row: persistedAttempt,
    reconciliationResult: {
      status: "payment_verified",
      evidence: {
        intentId,
        provider: "paystack",
        reference: providerReference,
        amountMinor: 1250,
        currency: "GHS",
        providerStatus: "success",
        verifiedAt: proof.claims.verifiedAt,
        transactionId: "tx-123",
      },
      proof,
    },
    rpcResponses: {
      settle_bundleup_gateway_order_payment: [{
        payment_id: paymentId,
        order_id: persistedAttempt.order_id,
        settled: true,
        already_settled: false,
      }],
    },
  });
  const result = await test.reconcile({ paymentId, userId: "user-1" });
  assert.equal(result.status, "payment_verified");
  assert.equal(result.settlement, "settled");
  const requestCall = test.state.rpcCalls.find(({ name }) =>
    name === "create_bundleup_gateway_reconciliation_request");
  const settlementCall = test.state.rpcCalls.find(({ name }) =>
    name === "settle_bundleup_gateway_order_payment");
  assert.ok(requestCall, "request correlation is persisted before reconciliation");
  assert.ok(settlementCall, "verified evidence invokes only the gateway settlement RPC");
  assert.equal(settlementCall.args.p_request_id, proof.requestId);
  assert.equal(settlementCall.args.p_signed_payload, `\\x${proof.payloadBytes.toString("hex")}`);
  assert.equal(settlementCall.args.p_signature, `\\x${proof.signatureBytes.toString("hex")}`);
}

{
  const proof = makeVerifiedProof();
  proof.claims.outcome = "pending";
  proof.claims.providerStatus = "pending";
  const test = loadAttempt({
    row: persistedAttempt,
    reconciliationResult: {
      status: "pending",
      observation: {
        intentId,
        provider: "paystack",
        reference: providerReference,
        amountMinor: 1250,
        currency: "GHS",
        providerStatus: "pending",
        verifiedAt: proof.claims.verifiedAt,
        transactionId: null,
      },
      proof,
    },
    rpcResponses: {
      record_bundleup_gateway_reconciliation_observation: "OBSERVED",
    },
  });
  const result = await test.reconcile({ paymentId, userId: "user-1" });
  assert.equal(result.status, "pending");
  assert.ok(test.state.rpcCalls.some(({ name }) =>
    name === "record_bundleup_gateway_reconciliation_observation"));
  assert.equal(test.state.rpcCalls.some(({ name }) =>
    name === "settle_bundleup_gateway_order_payment"), false);
}

{
  const originalProof = makeVerifiedProof();
  const proof = {
    ...makeVerifiedProof(),
    requestId: "00000000-0000-4000-8000-000000000003",
    requestNonce: "fresh-mock-nonce-00000000000",
    payloadBytes: Buffer.from("fresh signed payload bytes"),
    signatureBytes: Buffer.alloc(64, 8),
  };
  const asBytea = (value) => `\\x${value.toString("hex")}`;
  const paidAttempt = { ...persistedAttempt, status: "PAID" };
  const test = loadAttempt({
    row: persistedAttempt,
    reconciliationResult: {
      status: "payment_verified",
      evidence: {},
      proof,
    },
    rpcErrors: {
      settle_bundleup_gateway_order_payment: new Error("settlement acknowledgement lost"),
    },
    storedProof: originalProof,
    rows: {
      payments: [persistedAttempt, paidAttempt],
      orders: [{
        id: persistedAttempt.order_id,
        user_id: persistedAttempt.user_id,
        status: "PENDING_PAYMENT",
        payment_status: "PAID",
      }],
      bundleup_gateway_payment_evidence: [{
        payment_id: paymentId,
        request_id: originalProof.requestId,
        tenant_id: "vanta",
        order_reference: orderReference,
        intent_id: intentId,
        provider: "paystack",
        provider_reference: providerReference,
        amount_minor: 1250,
        currency: "GHS",
        provider_status: "success",
        verified_at: proof.claims.verifiedAt,
        transaction_id: "tx-123",
        request_nonce: originalProof.requestNonce,
        signed_payload: asBytea(originalProof.payloadBytes),
        signature: asBytea(originalProof.signatureBytes),
      }],
      bundleup_gateway_reconciliation_requests: [{
        id: proof.requestId,
        payment_id: paymentId,
        user_id: "user-1",
        request_nonce: proof.requestNonce,
        state: "CONSUMED",
        response_outcome: "payment_verified",
        response_payload: asBytea(proof.payloadBytes),
        response_signature: asBytea(proof.signatureBytes),
      }],
      payment_provider_reference_claims: [{
        provider: "paystack",
        actual_provider_reference: providerReference,
        payment_id: paymentId,
      }],
    },
  });
  const result = await test.reconcile({ paymentId, userId: "user-1" });
  assert.equal(result.status, "payment_verified", "a fresh-nonce settlement retry must read back the canonical settlement");
  assert.equal(result.settlement, "already_settled");
  assert.equal(test.state.rpcCalls.filter(({ name }) =>
    name === "settle_bundleup_gateway_order_payment").length, 1);
}

{
  const proof = makeVerifiedProof();
  const asBytea = (value) => `\\x${value.toString("hex")}`;
  const test = loadAttempt({
    row: { ...persistedAttempt, status: "PAID" },
    storedProof: proof,
    rows: {
      orders: [{
        id: persistedAttempt.order_id,
        user_id: persistedAttempt.user_id,
        status: "PENDING_PAYMENT",
        payment_status: "PAID",
      }],
      bundleup_gateway_payment_evidence: [{
        payment_id: paymentId,
        request_id: proof.requestId,
        tenant_id: "vanta",
        order_reference: orderReference,
        intent_id: intentId,
        provider: "paystack",
        provider_reference: providerReference,
        amount_minor: 1250,
        currency: "GHS",
        provider_status: "success",
        verified_at: proof.claims.verifiedAt,
        transaction_id: proof.claims.transactionId,
        request_nonce: proof.requestNonce,
        signed_payload: asBytea(proof.payloadBytes),
        signature: asBytea(proof.signatureBytes),
      }],
      bundleup_gateway_reconciliation_requests: [{
        id: proof.requestId,
        payment_id: paymentId,
        user_id: "user-1",
        request_nonce: proof.requestNonce,
        state: "CONSUMED",
        response_outcome: "payment_verified",
        response_payload: asBytea(proof.payloadBytes),
        response_signature: asBytea(proof.signatureBytes),
      }],
      payment_provider_reference_claims: [{
        provider: "paystack",
        actual_provider_reference: providerReference,
        payment_id: paymentId,
      }],
    },
  });
  const result = await test.reconcile({ paymentId, userId: "user-1" });
  assert.equal(result.status, "already_settled");
  assert.equal(result.paymentId, paymentId);
  assert.equal(test.state.reconciledTerms.length, 0, "an already-settled attempt is checked without new HTTP");
}

{
  const test = loadAttempt({ row: { ...persistedAttempt, user_id: "different-user" } });
  const result = await test.reconcile({ paymentId, userId: "user-1" });
  assert.equal(result.status, "unresolved");
  assert.equal(test.state.reconciledTerms.length, 0);
}

{
  const test = loadAttempt({ row: persistedAttempt, lookupError: new Error("database unavailable") });
  const result = await test.reconcile({ paymentId, userId: "user-1" });
  assert.equal(result.status, "unresolved");
  assert.equal(test.state.reconciledTerms.length, 0);
}

{
  const test = loadAttempt({ enabled: null, row: persistedAttempt });
  await assert.rejects(test.reconcile({ paymentId, userId: "user-1" }), (error) => error.code === "DISABLED");
  assert.equal(test.state.queries.length, 0);
}

{
  const initRoute = fs.readFileSync("app/api/payments/initialize/route.ts", "utf8");
  const verifyRoute = fs.readFileSync("app/api/payments/verify/route.ts", "utf8");
  const webhookRoute = fs.readFileSync("app/api/payments/webhook/route.ts", "utf8");
  const walletRoute = fs.readFileSync("app/api/account/wallet/deposit/route.ts", "utf8");
  const reconciliation = fs.readFileSync("lib/payments/bundleup-gateway.ts", "utf8");
  assert.match(initRoute, /initializePaystack/);
  assert.match(verifyRoute, /verifyAndSettlePaystack/);
  assert.match(webhookRoute, /verifyPaystack/);
  assert.match(walletRoute, /initializeWalletPaystack/);
  assert.doesNotMatch(reconciliation, /settle_paystack_order_payment|verifyAndSettlePaystack/);
  assert.doesNotMatch(reconciliation, /initializePaystack|initializeWalletPaystack/);
}

{
  const paymentFixtureId = "3c6a3be3-0d77-4fa2-95c7-493810d58343";
  const expectedBundleUpIntentId = "4573b97781484ea4c13e2d76f7e2389a95b9a09e67c31a0f19df1ae74e59d624";
  const disposableKeyId = "bundleup-disposable-test-2026-10-27-d7ffecb0";
  const disposablePublicKeyPem = [
    "-----BEGIN PUBLIC KEY-----",
    "MCowBQYDK2VwAyEAgvmzYPQl7U7nTgVyELY/eEevGfDaDbC9MlLizbk0caU=",
    "-----END PUBLIC KEY-----",
    "",
  ].join("\n");
  const fixtureEnvelope = {
    payload: "eyJ2ZXJzaW9uIjoxLCJrZXlfaWQiOiJidW5kbGV1cC1kaXNwb3NhYmxlLXRlc3QtMjAyNi0xMC0yNy1kN2ZmZWNiMCIsInRlbmFudF9pZCI6InZhbnRhIiwicGF5bWVudF9pZCI6IjNjNmEzYmUzLTBkNzctNGZhMi05NWM3LTQ5MzgxMGQ1ODM0MyIsIm9yZGVyX3JlZmVyZW5jZSI6IlZOVC1GSVhUVVJFLTAwMSIsImludGVudF9pZCI6IjQ1NzNiOTc3ODE0ODRlYTRjMTNlMmQ3NmY3ZTIzODlhOTViOWEwOWU2N2MzMWEwZjE5ZGYxYWU3NGU1OWQ2MjQiLCJyZXF1ZXN0X25vbmNlIjoiYnVuZGxldXAtZml4dHVyZS1ub25jZS0wMDAxIiwiaXNzdWVkX2F0IjoiMjAyNi0xMC0yN1QwNDo1NjozOS40MzlaIiwib3V0Y29tZSI6InBheW1lbnRfdmVyaWZpZWQiLCJwcm92aWRlciI6InBheXN0YWNrIiwicmVmZXJlbmNlIjoiVkFOVEEtNDU3M2I5Nzc4MTQ4NGVhNGMxM2UyZDc2ZjdlMjM4OWE5NWI5YTA5ZTY3YzMxYTBmMTlkZjFhZTc0ZTU5ZDYyNCIsImFtb3VudF9taW5vciI6MTI1MCwiY3VycmVuY3kiOiJHSFMiLCJwcm92aWRlcl9zdGF0dXMiOiJzdWNjZXNzIiwidmVyaWZpZWRfYXQiOiIyMDI2LTEwLTI3VDA0OjU2OjM5LjQzOVoiLCJ0cmFuc2FjdGlvbl9pZCI6ImZpeHR1cmUtdHJhbnNhY3Rpb24tMDAxIn0",
    signature: "uTJ45MyJ8QaVYbOMVefjepgVJUC9UfN351l12nBNx-RVAhb0bE86LY4-Az5R7ODpnopo1J4jTPsAnlLmo2A4Bg",
  };
  const fixturePayloadBytes = Buffer.from(fixtureEnvelope.payload, "base64url");
  const fixtureSignatureBytes = Buffer.from(fixtureEnvelope.signature, "base64url");
  const disposablePublicKey = crypto.createPublicKey(disposablePublicKeyPem);
  assert.equal(fixturePayloadBytes.toString("base64url"), fixtureEnvelope.payload);
  assert.equal(fixtureSignatureBytes.toString("base64url"), fixtureEnvelope.signature);

  const fixturePayload = JSON.parse(fixturePayloadBytes.toString("utf8"));
  assert.equal(fixturePayload.payment_id, paymentFixtureId);
  assert.equal(fixturePayload.tenant_id, "vanta");
  assert.equal(fixturePayload.intent_id, expectedBundleUpIntentId);
  assert.equal(fixturePayload.reference, `VANTA-${expectedBundleUpIntentId}`);

  const validSignature = crypto.verify(null, fixturePayloadBytes, disposablePublicKey, fixtureSignatureBytes);
  assert.equal(validSignature, true, "signature verifies over the exact decoded fixture bytes");
  const changedPayloadBytes = Buffer.from(fixturePayloadBytes);
  changedPayloadBytes[changedPayloadBytes.length - 1] ^= 1;
  assert.equal(
    crypto.verify(null, changedPayloadBytes, disposablePublicKey, fixtureSignatureBytes),
    false,
    "changing one decoded payload byte is rejected",
  );
  const changedSignatureBytes = Buffer.from(fixtureSignatureBytes);
  changedSignatureBytes[0] ^= 1;
  assert.equal(
    crypto.verify(null, fixturePayloadBytes, disposablePublicKey, changedSignatureBytes),
    false,
    "changing the signature is rejected",
  );
  assert.equal(
    crypto.verify(null, fixturePayloadBytes, publicKey, fixtureSignatureBytes),
    false,
    "an unrelated public key is rejected",
  );

  const { gateway } = loadGateway({
    env: {
      VANTA_BUNDLEUP_GATEWAY_EVIDENCE_PUBLIC_KEYS: JSON.stringify({
        [disposableKeyId]: disposablePublicKeyPem,
      }),
    },
  });
  const vantaIntentId = gateway.deriveBundleUpGatewayIntentId(paymentFixtureId);
  const derivationInput = Buffer.from(`vanta\0idempotency:${paymentFixtureId.toLowerCase()}`, "utf8");
  assert.equal(derivationInput.filter((byte) => byte === 0).length, 1);
  assert.equal(derivationInput.includes(Buffer.from("\\0", "utf8")), false);
  const independentlyComputedIntentId = crypto.createHash("sha256").update(derivationInput).digest("hex");
  assert.equal(independentlyComputedIntentId, vantaIntentId);
  assert.equal(
    independentlyComputedIntentId,
    expectedBundleUpIntentId,
    "VANTA's implementation-specific derivation result",
  );
  assert.equal(vantaIntentId, fixturePayload.intent_id);
  const verifiedFixture = gateway.verifyStoredBundleUpGatewayEvidence({
    paymentId: paymentFixtureId,
    orderReference: "VNT-FIXTURE-001",
    amountMinor: 1250,
    currency: "GHS",
    intentId: null,
    providerReference: null,
    requestId: "disposable-key-fixture-check",
    requestNonce: "bundleup-fixture-nonce-0001",
    payloadBytes: fixturePayloadBytes,
    signatureBytes: fixtureSignatureBytes,
  });
  assert.equal(verifiedFixture.claims.paymentId, paymentFixtureId);
  assert.equal(verifiedFixture.claims.tenantId, "vanta");
  assert.equal(verifiedFixture.claims.intentId, expectedBundleUpIntentId);
  assert.equal(verifiedFixture.claims.reference, `VANTA-${expectedBundleUpIntentId}`);
}

console.log("bundleup-gateway-reconciliation-tests: passed (mocked HTTP, test-only Ed25519 keys, mocked persistence)");
