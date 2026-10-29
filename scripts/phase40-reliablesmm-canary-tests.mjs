import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";

const requestSource = fs.readFileSync("lib/fulfillment/reliablesmm/request.ts", "utf8");
const requestModule = { exports: {} };
const requestJs = ts.transpileModule(requestSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
vm.runInNewContext(requestJs, {
  module: requestModule,
  exports: requestModule.exports,
  require(specifier) {
    if (specifier === "./reserved-keys") {
      return { RELIABLESMM_RESERVED_TRANSPORT_KEYS: new Set(["action", "service", "quantity", "link", "key"]) };
    }
    throw new Error(`Unexpected provider request import: ${specifier}`);
  },
});
const { buildReliableSMMProviderRequest } = requestModule.exports;

const orderId = "ab1030cc-41b9-4f57-bae8-4226d9f6423d";
const normalizedLink = "https://instagram.com/p/canary";
const order = {
  id: orderId,
  total: 0.1,
  currency: "GHS",
  payment_status: "PAID",
  fulfillment_status: "NOT_STARTED",
  target_type: "url",
  target_value: "https://instagram.com/p/canary#fragment",
  quantity: 100,
  services: { slug: "instagram-views" },
};
const env = {
  CRON_SECRET: "test-cron-secret",
  PANELS_LIVE_FULFILLMENT_ENABLED: "true",
  RELIABLESMM_API_KEY: "test-provider-key",
  RELIABLESMM_CANARY_ORDER_ID: orderId,
};
const calls = { claim: 0, release: 0, fulfill: [], context: [], request: [] };
const logs = [];
let canClaim = true;
let fulfillError = null;
let mappedServiceId = "2037";
let orderLookupError = null;

const admin = {
  from(table) {
    assert.equal(table, "orders");
    const query = {
      select() { return this; },
      eq() { return this; },
      async maybeSingle() {
        if (orderLookupError) throw orderLookupError;
        return { data: order, error: null };
      },
    };
    return query;
  },
};
const routeSource = fs.readFileSync("app/api/internal/fulfillment/canary/route.ts", "utf8");
const callerScript = fs.readFileSync("scripts/invoke-reliablesmm-canary.ps1", "utf8");
const routeJs = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const routeModule = { exports: {} };
vm.runInNewContext(routeJs, {
  module: routeModule,
  exports: routeModule.exports,
  process: { env },
  console: {
    info: (...args) => logs.push({ level: "info", args }),
    error: (...args) => logs.push({ level: "error", args }),
  },
  require(specifier) {
    if (specifier === "next/server") return { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } };
    if (specifier === "node:crypto") return crypto;
    if (specifier === "../../../../../lib/supabase/server") return { createSupabaseAdminClient: () => admin };
    if (specifier === "../../../../../lib/fulfillment/claims") return {
      claimOrder: async () => { calls.claim++; return canClaim; },
      releaseOrderClaim: async () => { calls.release++; },
    };
    if (specifier === "../../../../../lib/fulfillment/worker") return {
      fulfillPaidOrder: async (input) => {
        calls.fulfill.push(input);
        if (fulfillError) throw fulfillError;
        return { outcome: "SUBMITTED" };
      },
      loadDynamicOrderExecutionContext: async (id) => {
        calls.context.push(id);
        return {
          provider: "reliablesmm",
          providerServiceId: mappedServiceId,
          payload: { link: normalizedLink },
        };
      },
    };
    if (specifier === "../../../../../lib/fulfillment/resolver") return {
      resolveProviderForService: async () => ({
        mapping: { provider: "reliablesmm", providerServiceId: mappedServiceId },
      }),
    };
    if (specifier === "../../../../../lib/fulfillment/reliablesmm/request") return { buildReliableSMMProviderRequest };
    if (specifier === "../../../../../lib/fulfillment/reliablesmm/target") return {
      assertReliableSMMTarget: ({ targetValue }) => ({ link: targetValue }),
    };
    throw new Error(`Unexpected canary route import: ${specifier}`);
  },
});

function request(id = orderId) {
  return {
    headers: { get: (name) => name === "authorization" ? `Bearer ${env.CRON_SECRET}` : null },
    json: async () => ({ orderId: id }),
  };
}

const route = routeModule.exports;
const accepted = await route.POST(request());
assert.equal(accepted.status, 200);
assert.equal(calls.fulfill.length, 1);
assert.equal(calls.fulfill[0].orderId, orderId);
assert.equal(calls.fulfill[0].allowLiveSubmission, true);
assert.equal(calls.fulfill[0].canaryOrderAuthorization, true);
assert.equal(calls.fulfill[0].vantaSlug, "instagram-views");
assert.equal(calls.fulfill[0].targetType, "url");
assert.equal(calls.fulfill[0].quantity, 100);
assert.equal(calls.claim, 1);
assert.equal(calls.release, 1);
assert.deepEqual(calls.context, [orderId]);

const disabledCalls = calls.fulfill.length;
env.PANELS_LIVE_FULFILLMENT_ENABLED = "false";
const disabled = await route.POST(request());
assert.equal(disabled.status, 423);
assert.equal(calls.fulfill.length, disabledCalls, "The canary route must not submit while live fulfillment is disabled.");
env.PANELS_LIVE_FULFILLMENT_ENABLED = "true";

const wrongOrder = await route.POST(request("11111111-1111-4111-8111-111111111111"));
assert.equal(wrongOrder.status, 403);
assert.equal(calls.fulfill.length, disabledCalls);

order.quantity = 10000;
const wrongQuantity = await route.POST(request());
assert.equal(wrongQuantity.status, 409);
assert.equal(calls.fulfill.length, disabledCalls);
order.quantity = 100;
order.total = 10;
const wrongTotal = await route.POST(request());
assert.equal(wrongTotal.status, 409);
assert.equal(calls.fulfill.length, disabledCalls);
order.total = 0.1;

mappedServiceId = "7486";
const wrongService = await route.POST(request());
assert.equal(wrongService.status, 423);
assert.equal(calls.fulfill.length, disabledCalls);
mappedServiceId = "2037";

canClaim = false;
const duplicate = await route.POST(request());
assert.equal(duplicate.status, 409);
assert.equal(calls.fulfill.length, disabledCalls, "A claimed order must not enter the fulfillment worker.");
canClaim = true;

fulfillError = Object.assign(
  new Error(`mock failure with secret ${env.CRON_SECRET}, provider key ${env.RELIABLESMM_API_KEY}, and target ${normalizedLink}`),
  { code: "PROVIDER_REJECTED" },
);
const failed = await route.POST(request());
assert.equal(failed.status, 502);
assert.equal(failed.body.error, "Canary fulfillment failed.");
assert.equal(failed.body.errorName, "Error");
assert.equal(failed.body.errorCode, "PROVIDER_REJECTED");
assert.equal(failed.body.executionStage, "worker_fulfillment");
assert.equal(typeof failed.body.requestId, "string");
assert.equal(calls.release, 2, "The order claim must be released after a failed worker call.");
const workerFailureLog = logs
  .filter((entry) => entry.level === "error")
  .map((entry) => entry.args[0])
  .map((entry) => JSON.parse(entry))
  .find((entry) => entry.event === "fulfillment_canary_worker_failed");
assert.ok(workerFailureLog);
assert.equal(workerFailureLog.errorName, "Error");
assert.equal(workerFailureLog.errorCode, "PROVIDER_REJECTED");
assert.equal(workerFailureLog.executionStage, "worker_fulfillment");
assert.equal(workerFailureLog.requestId, failed.body.requestId);
const failureOutput = JSON.stringify({ log: workerFailureLog, body: failed.body });
assert.doesNotMatch(failureOutput, /test-cron-secret|test-provider-key|instagram\.com|mock failure with secret/);

fulfillError = null;
orderLookupError = Object.assign(
  new Error(`database failure with secret ${env.CRON_SECRET}, provider key ${env.RELIABLESMM_API_KEY}, and target ${normalizedLink}`),
  { code: "23505" },
);
const unhandled = await route.POST(request());
assert.equal(unhandled.status, 500);
assert.equal(unhandled.body.error, "Canary request failed unexpectedly.");
assert.equal(unhandled.body.errorName, "Error");
assert.equal(unhandled.body.errorCode, "23505");
assert.equal(unhandled.body.executionStage, "order_lookup");
assert.equal(typeof unhandled.body.requestId, "string");
const unhandledLog = logs
  .filter((entry) => entry.level === "error")
  .map((entry) => JSON.parse(entry.args[0]))
  .find((entry) => entry.event === "fulfillment_canary_unhandled_error");
assert.ok(unhandledLog);
assert.equal(unhandledLog.errorName, "Error");
assert.equal(unhandledLog.errorCode, "23505");
assert.equal(unhandledLog.executionStage, "order_lookup");
assert.equal(unhandledLog.requestId, unhandled.body.requestId);
assert.doesNotMatch(JSON.stringify({ log: unhandledLog, body: unhandled.body }), /test-cron-secret|test-provider-key|instagram\.com|database failure with secret/);

assert.match(callerScript, /-Method Post/);
assert.match(callerScript, /http:\/\/127\.0\.0\.1:3000\/api\/internal\/fulfillment\/canary/);
assert.match(callerScript, /Get-NetTCPConnection -State Listen -LocalPort 3000/);
assert.match(callerScript, /projectPathPattern = \[regex\]::Escape\(\$projectPath\)/);
assert.match(callerScript, /serverStartedAt -lt \(Get-Item "\.env\.local"\)\.LastWriteTime/);
assert.equal((callerScript.match(/Invoke-WebRequest/g) ?? []).length, 1, "The canary helper must issue at most one HTTP request.");
assert.match(callerScript, /PANELS_LIVE_FULFILLMENT_ENABLED/);
assert.match(callerScript, /R4_TEST_MODE/);

console.log("phase40-reliablesmm-canary-tests: passed; all provider operations mocked");
