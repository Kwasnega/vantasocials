import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const helperSource = fs.readFileSync("lib/account/overview.ts", "utf8");
const pageSource = fs.readFileSync("app/account/page.tsx", "utf8");
const migration = fs.readFileSync(
  "supabase/migrations/20261012000001_customer_account_overview_aggregate.sql",
  "utf8",
);
const compiled = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports });
const { formatSpendByCurrency, getAccountOverviewStats, parseAccountOverviewStats } = module.exports;

const sample = {
  total_orders: 12,
  completed_orders: 5,
  processing_orders: 3,
  pending_orders: 4,
  spend_by_currency: [
    { currency: "GHS", total: "125.50" },
    { currency: "USD", total: "10.00" },
  ],
};

{
  const stats = parseAccountOverviewStats(sample);
  assert.deepEqual(JSON.parse(JSON.stringify(stats)), {
    totalOrders: 12,
    completedOrders: 5,
    processingOrders: 3,
    pendingOrders: 4,
    spendByCurrency: [
      { currency: "GHS", total: "125.50" },
      { currency: "USD", total: "10.00" },
    ],
  });
  assert.equal(formatSpendByCurrency(stats.spendByCurrency), "125.50 GHS · 10.00 USD");
  assert.notEqual(formatSpendByCurrency(stats.spendByCurrency), "135.50 GHS");
}

{
  const empty = parseAccountOverviewStats({
    total_orders: 0,
    completed_orders: 0,
    processing_orders: 0,
    pending_orders: 0,
    spend_by_currency: [],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(empty)), {
    totalOrders: 0,
    completedOrders: 0,
    processingOrders: 0,
    pendingOrders: 0,
    spendByCurrency: [],
  });
  assert.equal(formatSpendByCurrency(empty.spendByCurrency), "0.00 GHS");
}

for (const invalid of [
  null,
  { ...sample, total_orders: -1 },
  { ...sample, completed_orders: "not-a-count" },
  { ...sample, spend_by_currency: [{ currency: "GHS", total: "not-money" }] },
  { ...sample, spend_by_currency: [{ currency: "ghs", total: "10.00" }] },
]) {
  assert.throws(() => parseAccountOverviewStats(invalid), /Invalid account overview/);
}

{
  const calls = [];
  const db = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: sample, error: null };
    },
  };
  const result = await getAccountOverviewStats(db, "customer-123");
  assert.equal(calls.length, 1, "account aggregates are requested with one RPC");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {
    name: "get_customer_account_overview",
    args: { p_user_id: "customer-123" },
  });
  assert.equal(result.totalOrders, 12);
}

{
  const failure = new Error("database unavailable");
  await assert.rejects(
    getAccountOverviewStats({ rpc: async () => ({ data: null, error: failure }) }, "customer-123"),
    (error) => error === failure,
  );
}

assert.match(migration, /where user_id = p_user_id/);
assert.match(migration, /count\(\*\) as total_orders/);
assert.match(migration, /count\(\*\) filter \(where fulfillment_status = 'COMPLETED'\)/i);
assert.match(migration, /fulfillment_status in \('PROCESSING', 'SUBMITTING', 'SUBMITTED'\)/);
assert.match(migration, /payment_status in \('UNPAID', 'PENDING'\)\s+or fulfillment_status = 'FAILED'/);
assert.match(migration, /sum\(total\) filter \(where payment_status = 'PAID'\)/i);
assert.match(migration, /group by currency/);
assert.match(migration, /revoke all on function public\.get_customer_account_overview\(uuid\) from public, anon, authenticated/i);
assert.match(migration, /grant execute on function public\.get_customer_account_overview\(uuid\) to service_role/i);

assert.match(pageSource, /getAccountOverviewStats\(db, user\.id\)/);
assert.match(pageSource, /select\("public_order_id,total,currency,payment_status,fulfillment_status"\)/);
assert.match(pageSource, /\.order\("created_at", \{ ascending: false \}\)\.limit\(5\)/);
assert.doesNotMatch(pageSource, /\.eq\("payment_status", "PAID"\)/);
assert.doesNotMatch(pageSource, /\.reduce\(\(sum, order\)/);
assert.match(pageSource, /TOTAL ORDERS/);
assert.match(pageSource, /TOTAL SPENT/);
assert.doesNotMatch(pageSource, /PENDING \/ FAILED|Orders delivered|Unsuccessful orders|In progress/);
assert.doesNotMatch(pageSource, /COMPLETED|PROCESSING/);
assert.equal((pageSource.match(/Promise\.all\(/g) ?? []).length, 1);

console.log("account-overview-tests: passed");
