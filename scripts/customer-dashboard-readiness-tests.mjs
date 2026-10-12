import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const ordersPage = fs.readFileSync("app/account/orders/page.tsx", "utf8");
const orderDetailPage = fs.readFileSync("app/account/orders/[id]/page.tsx", "utf8");
const walletPage = fs.readFileSync("app/account/wallet/page.tsx", "utf8");
const formatterSource = fs.readFileSync("lib/orders/display-input-values.ts", "utf8");
const checkoutPage = fs.readFileSync("app/checkout/page.tsx", "utf8");

assert.match(ordersPage, /query\.in\("fulfillment_status", \["PROCESSING", "SUBMITTING", "SUBMITTED"\]\)/);
assert.match(ordersPage, /select name="date" defaultValue=\{date\}/);
assert.match(ordersPage, /query\.gte\("created_at"/);
assert.match(ordersPage, /date=\$\{date\}&page=/);
assert.match(ordersPage, /target_value,input_values/);
assert.match(ordersPage, /order-history-inputs/);
assert.match(ordersPage, /formatOrderInputValue\(value\)/);
assert.match(ordersPage, /if \(serviceSearchError\) throw serviceSearchError/);
assert.match(ordersPage, /if \(ordersError\) throw ordersError/);

assert.match(walletPage, /if \(walletError\) throw walletError/);
assert.match(walletPage, /if \(result\.error\) throw result\.error/);

assert.match(orderDetailPage, /if \(error\) throw error/);
assert.match(orderDetailPage, /if \(!order\) notFound\(\)/);
assert.match(orderDetailPage, /input_values,services/);
assert.match(orderDetailPage, /inputValues\.length === 0 \?[\s\S]*?order\.target_value/);
assert.match(orderDetailPage, /formatOrderInputValue\(value\)/);
assert.match(checkoutPage, /formatOrderInputValue\(val\)/);

const formatter = ts.transpileModule(formatterSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(formatter, { module, exports: module.exports });
const { formatOrderInputValue } = module.exports;
assert.equal(formatOrderInputValue("https://example.test/post"), "https://example.test/post");
assert.equal(formatOrderInputValue({ lines: ["first comment", "second comment"] }), "first comment\nsecond comment");
assert.equal(formatOrderInputValue(["one", "two"]), "one, two");

console.log("customer-dashboard-readiness-tests: passed");
