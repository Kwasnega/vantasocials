import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("lib/orders/timeline.ts", "utf8");
const pageSource = fs.readFileSync("app/account/orders/[id]/page.tsx", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports });
const { buildOrderTimeline } = module.exports;

const createdAt = "2026-10-01T10:00:00.000Z";
const timeline = buildOrderTimeline({
  orderId: "order-1",
  createdAt,
  payments: [{
    id: "payment-1",
    provider: "paystack",
    status: "PAID",
    created_at: "2026-10-01T10:01:00.000Z",
    paid_at: "2026-10-01T10:02:00.000Z",
    updated_at: "2026-10-01T10:02:00.000Z",
  }],
  walletTransactions: [{
    id: "refund-1",
    type: "REFUND",
    direction: "CREDIT",
    status: "COMPLETED",
    created_at: "2026-10-01T10:05:00.000Z",
    updated_at: "2026-10-01T10:05:00.000Z",
  }],
  providerAttempts: [{
    id: "attempt-1",
    attempt_number: 1,
    attempt_status: "SUBMITTED",
    request_started_at: "2026-10-01T10:03:00.000Z",
    response_received_at: "2026-10-01T10:04:00.000Z",
    created_at: "2026-10-01T10:03:00.000Z",
  }],
  providerEvents: [
    {
      id: "fulfillment-transition",
      provider_order_id: null,
      event_type: "CUSTOMER_FULFILLMENT_TRANSITION",
      provider_status: null,
      metadata: { from: "NOT_STARTED", to: "SUBMITTING" },
      created_at: "2026-10-01T10:03:30.000Z",
    },
    {
      id: "provider-status-1",
      provider_order_id: "attempt-1",
      event_type: "PROVIDER_STATUS_OBSERVED",
      provider_status: "PROCESSING",
      metadata: {},
      created_at: "2026-10-01T10:06:00.000Z",
    },
    {
      id: "provider-status-duplicate",
      provider_order_id: "attempt-1",
      event_type: "PROVIDER_STATUS_OBSERVED",
      provider_status: "PROCESSING",
      metadata: {},
      created_at: "2026-10-01T10:07:00.000Z",
    },
    {
      id: "provider-status-2",
      provider_order_id: "attempt-1",
      event_type: "PROVIDER_STATUS_OBSERVED",
      provider_status: "COMPLETED",
      metadata: {},
      created_at: "2026-10-01T10:08:00.000Z",
    },
  ],
});

assert.deepEqual(
  JSON.parse(JSON.stringify(timeline.map(({ label, detail, occurredAt }) => [label, detail, occurredAt]))),
  [
    ["Order created", null, createdAt],
    ["Payment attempt started", "via Paystack", "2026-10-01T10:01:00.000Z"],
    ["Payment confirmed", "via Paystack", "2026-10-01T10:02:00.000Z"],
    ["Fulfillment submission started", null, "2026-10-01T10:03:00.000Z"],
    ["Fulfillment status changed", "Not Started → Submitting", "2026-10-01T10:03:30.000Z"],
    ["Provider accepted order", null, "2026-10-01T10:04:00.000Z"],
    ["Wallet refund completed", null, "2026-10-01T10:05:00.000Z"],
    ["Provider update: Processing", null, "2026-10-01T10:06:00.000Z"],
    ["Provider update: Completed", null, "2026-10-01T10:08:00.000Z"],
  ],
);

const emptyHistory = buildOrderTimeline({
  orderId: "order-2",
  createdAt,
  payments: [],
  walletTransactions: [],
  providerAttempts: [],
  providerEvents: [],
});
assert.equal(emptyHistory.length, 1);
assert.equal(emptyHistory[0].label, "Order created");

assert.match(pageSource, /\.from\("payments"\)/);
assert.match(pageSource, /\.from\("wallet_transactions"\)/);
assert.match(pageSource, /\.from\("provider_orders"\)/);
assert.match(pageSource, /\.from\("provider_order_events"\)/);
assert.match(pageSource, /buildOrderTimeline\(/);
assert.doesNotMatch(pageSource, /Latest update/);
assert.doesNotMatch(pageSource, /dateTime=\{order\.updated_at\}/);

console.log("order-timeline-tests: passed");
