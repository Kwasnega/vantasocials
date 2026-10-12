import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const payment = {
  id: "payment-1",
  order_id: "order-1",
  user_id: "user-1",
  reference: "VANTA-123",
  amount: "12.34",
  currency: "GHS",
  status: "PENDING",
};
const order = {
  id: "order-1",
  total: "12.34",
  currency: "GHS",
  status: "PENDING_PAYMENT",
  payment_status: "UNPAID",
  user_id: "user-1",
};
const validResponse = {
  status: true,
  data: {
    status: "success",
    reference: payment.reference,
    amount: "1234",
    currency: "GHS",
    id: 456,
  },
};

function loadSettlement({
  paymentRecord = payment,
  orderRecord = order,
  paymentError = null,
  orderError = null,
  providerResponse = validResponse,
  providerError = null,
  rpcResult = [{ settled: true, already_settled: false }],
  rpcError = null,
} = {}) {
  const queries = [];
  const rpcCalls = [];
  let verificationCalls = 0;
  const verifyPaystack = async () => {
    verificationCalls += 1;
    if (providerError) throw providerError;
    return providerResponse;
  };
  const admin = {
    from(table) {
      const query = { table, filters: [] };
      queries.push(query);
      return {
        select() {
          return this;
        },
        eq(column, value) {
          query.filters.push([column, value]);
          return this;
        },
        async maybeSingle() {
          if (table === "payments") return { data: paymentRecord, error: paymentError };
          if (table === "orders") return { data: orderRecord, error: orderError };
          throw new Error(`Unexpected table in settlement test: ${table}`);
        },
      };
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return { data: rpcResult, error: rpcError };
    },
  };

  const source = fs.readFileSync("lib/payments/settle.ts", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  const require = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier === "../supabase/server") return { createSupabaseAdminClient: () => admin };
    if (specifier === "./paystack") {
      return {
        amountToMinorUnits(value) {
          const [whole, fraction = ""] = value.trim().split(".");
          return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
        },
        verifyPaystack,
      };
    }
    throw new Error(`Unexpected import in settlement test: ${specifier}`);
  };
  vm.runInNewContext(compiled, { module, exports: module.exports, require });

  return {
    verifyAndSettlePaystack: module.exports.verifyAndSettlePaystack,
    admin,
    verifyPaystack,
    queries,
    rpcCalls,
    get verificationCalls() {
      return verificationCalls;
    },
  };
}

function loadInitializationRoute(settlement) {
  const source = fs.readFileSync("app/api/payments/initialize/route.ts", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  const require = (specifier) => {
    if (specifier === "node:crypto") return { default: { randomUUID: () => "new-reference" } };
    if (specifier === "next/server") {
      return { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } };
    }
    if (specifier === "../../../../lib/supabase/server") {
      return {
        createSupabaseAdminClient: () => settlement.admin,
        getCurrentUser: async () => ({ id: payment.user_id, email: "customer@example.test" }),
      };
    }
    if (specifier === "../../../../lib/payments/paystack") {
      return {
        verifyPaystack: settlement.verifyPaystack,
        initializePaystack: async () => {
          throw new Error("Unexpected initialization in successful recovery test.");
        },
      };
    }
    if (specifier === "../../../../lib/payments/settle") {
      return { verifyAndSettlePaystack: settlement.verifyAndSettlePaystack };
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
    throw new Error(`Unexpected import in initialization test: ${specifier}`);
  };
  vm.runInNewContext(compiled, { module, exports: module.exports, require, process });
  return module.exports.POST;
}

{
  const test = loadSettlement();
  const verified = validResponse;
  const result = await test.verifyAndSettlePaystack(payment.reference, payment.user_id, verified);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { found: true, paid: true });
  assert.equal(test.verificationCalls, 0, "a supplied provider response is reused");
  assert.equal(test.rpcCalls.length, 1, "a valid response attempts settlement exactly once");
  assert.deepEqual(test.queries[0].filters, [["provider", "paystack"], ["reference", payment.reference]]);
  assert.deepEqual(test.queries[1].filters, [["id", payment.order_id], ["user_id", payment.user_id]]);
  assert.equal(test.rpcCalls[0].name, "settle_paystack_order_payment");
  assert.deepEqual(JSON.parse(JSON.stringify(test.rpcCalls[0].args)), {
    p_payment_id: payment.id,
    p_expected_user_id: payment.user_id,
    p_verified_reference: payment.reference,
    p_verified_amount_minor: "1234",
    p_verified_currency: "GHS",
    p_transaction_id: "456",
    p_provider_response: { verified: true },
  });
}

{
  const test = loadSettlement();
  const post = loadInitializationRoute(test);
  const response = await post(new Request("http://localhost/api/payments/initialize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ order_id: "VNT-123" }),
  }));
  assert.equal(response.status, 409);
  assert.equal(test.verificationCalls, 1, "existing-payment initialization verifies with the provider once");
  assert.equal(test.rpcCalls.length, 1, "the same provider response reaches settlement");
}

for (const status of ["failed", "pending", "abandoned", "reversed", undefined]) {
  const test = loadSettlement();
  const response = status === undefined
    ? { status: true }
    : { status: true, data: { ...validResponse.data, status } };
  const result = await test.verifyAndSettlePaystack(payment.reference, payment.user_id, response);
  assert.equal(result.paid, false, `${String(status)} provider status is not settled`);
  assert.equal(test.rpcCalls.length, 0);
}

{
  const test = loadSettlement();
  const result = await test.verifyAndSettlePaystack(payment.reference, payment.user_id, { status: false, data: validResponse.data });
  assert.equal(result.paid, false, "malformed/unsuccessful provider envelope is rejected");
  assert.equal(test.rpcCalls.length, 0);
}

const invalidResponses = [
  { label: "reference mismatch", data: { ...validResponse.data, reference: "OTHER" } },
  { label: "provider amount mismatch", data: { ...validResponse.data, amount: "1233" } },
  { label: "currency mismatch", data: { ...validResponse.data, currency: "USD" } },
  { label: "missing transaction data", data: null },
];
for (const invalid of invalidResponses) {
  const test = loadSettlement();
  const result = await test.verifyAndSettlePaystack(payment.reference, payment.user_id, {
    status: true,
    data: invalid.data,
  });
  assert.equal(result.paid, false, invalid.label);
  assert.equal(test.rpcCalls.length, 0, `${invalid.label} never reaches settlement`);
}

for (const [label, overrides] of [
  ["payment amount mismatch", { paymentRecord: { ...payment, amount: "12.33" } }],
  ["payment currency mismatch", { paymentRecord: { ...payment, currency: "USD" } }],
  ["order currency mismatch", { orderRecord: { ...order, currency: "USD" } }],
  ["order amount mismatch", { orderRecord: { ...order, total: "12.33" } }],
]) {
  const test = loadSettlement(overrides);
  const result = await test.verifyAndSettlePaystack(payment.reference, payment.user_id, validResponse);
  assert.equal(result.paid, false, label);
  assert.equal(test.rpcCalls.length, 0, `${label} never reaches settlement`);
}

{
  const test = loadSettlement({ paymentRecord: null });
  const result = await test.verifyAndSettlePaystack(payment.reference, payment.user_id, validResponse);
  assert.equal(result.found, false);
  assert.equal(test.queries.length, 1);
  assert.equal(test.rpcCalls.length, 0);
}

{
  const test = loadSettlement({ paymentRecord: { ...payment, reference: "OTHER" } });
  const result = await test.verifyAndSettlePaystack(payment.reference, payment.user_id, validResponse);
  assert.equal(result.found, false, "the loaded payment must have the requested reference");
  assert.equal(test.rpcCalls.length, 0);
}

{
  const test = loadSettlement({ orderRecord: null });
  const result = await test.verifyAndSettlePaystack(payment.reference, payment.user_id, validResponse);
  assert.equal(result.found, false);
  assert.deepEqual(test.queries[1].filters, [["id", payment.order_id], ["user_id", payment.user_id]]);
  assert.equal(test.rpcCalls.length, 0);
}

for (const [label, overrides, failingTable] of [
  ["payment lookup error", { paymentError: new Error("payment query failed") }, "payments"],
  ["order lookup error", { orderError: new Error("order query failed") }, "orders"],
]) {
  const test = loadSettlement(overrides);
  await assert.rejects(
    test.verifyAndSettlePaystack(payment.reference, payment.user_id, validResponse),
    /query failed/,
    label,
  );
  assert.equal(test.verificationCalls, 0, `${label} does not contact the provider`);
  assert.equal(test.rpcCalls.length, 0, `${label} does not attempt settlement`);
}

{
  const test = loadSettlement();
  const result = await test.verifyAndSettlePaystack(payment.reference, "another-user", validResponse);
  assert.equal(result.found, false);
  assert.equal(test.queries.length, 1, "wrong expected user stops before loading the order");
  assert.equal(test.rpcCalls.length, 0);
}

{
  const test = loadSettlement({ orderRecord: { ...order, id: "different-order" } });
  const result = await test.verifyAndSettlePaystack(payment.reference, payment.user_id, validResponse);
  assert.equal(result.found, false, "payment/order association mismatch is rejected");
  assert.equal(test.rpcCalls.length, 0);
}

{
  const providerError = new Error("provider unavailable");
  const test = loadSettlement({ providerError });
  await assert.rejects(test.verifyAndSettlePaystack(payment.reference, payment.user_id), (error) => error === providerError);
  assert.equal(test.verificationCalls, 1);
  assert.equal(test.rpcCalls.length, 0);
}

{
  const rpcError = new Error("settlement conflict");
  const test = loadSettlement({ rpcError });
  await assert.rejects(
    test.verifyAndSettlePaystack(payment.reference, payment.user_id, validResponse),
    (error) => error === rpcError,
  );
  assert.equal(test.rpcCalls.length, 1, "RPC failures and conflicting states remain visible");
}

for (const rpcResult of [
  [{ settled: true, already_settled: true }],
  [{ settled: false, already_settled: false }],
]) {
  const test = loadSettlement({ rpcResult });
  const result = await test.verifyAndSettlePaystack(payment.reference, payment.user_id, validResponse);
  assert.equal(result.paid, Boolean(rpcResult[0].settled));
  assert.equal(test.rpcCalls.length, 1, "the atomic RPC remains authoritative for idempotency/state");
}

{
  const test = loadSettlement();
  const result = await test.verifyAndSettlePaystack(payment.reference, payment.user_id);
  assert.equal(result.paid, true);
  assert.equal(test.verificationCalls, 1, "customer verification and webhook helper callers still fetch their own provider response");
}

{
  const verifyRoute = fs.readFileSync("app/api/payments/verify/route.ts", "utf8");
  const webhookRoute = fs.readFileSync("app/api/payments/webhook/route.ts", "utf8");
  const walletVerifyRoute = fs.readFileSync("app/api/account/wallet/deposit/verify/route.ts", "utf8");
  assert.match(verifyRoute, /verifyAndSettlePaystack\(reference,\s*user\.id\)/);
  assert.match(webhookRoute, /verifyAndSettlePaystack\(reference\)/);
  assert.match(walletVerifyRoute, /verifyPaystack\(reference\)/);
  assert.match(webhookRoute, /const verified = await verifyPaystack\(reference\)/);
  assert.doesNotMatch(walletVerifyRoute, /verifyAndSettlePaystack/);
}

console.log("paystack-settlement-tests: passed");
