import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const detail = fs.readFileSync("app/admin/orders/[id]/page.tsx", "utf8");
const list = fs.readFileSync("app/admin/orders/page.tsx", "utf8");
const orderListHelper = fs.readFileSync("lib/admin/order-list.ts", "utf8");
const formatterSource = fs.readFileSync("lib/orders/display-input-values.ts", "utf8");

assert.match(detail, /input_schema_snapshot,input_values/);
assert.match(detail, /snapshotByKey/);
assert.match(detail, /formatOrderInputValue\(value\)/);
assert.match(detail, /order-input-value/);
assert.match(detail, /Internal order ID/);
assert.match(detail, /Public order ID/);
assert.match(detail, /Customer unit-price snapshot/);
assert.match(detail, /paymentsError \? <AdminQueryError/);
assert.match(detail, /providerOrdersError \? <AdminQueryError/);
assert.match(detail, /walletEntriesError \? <AdminQueryError/);
assert.match(detail, /VANTA provider-attempt ID/);
assert.match(detail, /External provider order ID/);
assert.match(detail, /Provider service ID/);
assert.doesNotMatch(detail, /provider_response/);
assert.doesNotMatch(detail, /profiles\(email/);

assert.match(list, /"PROCESSING", "SUBMITTING", "SUBMITTED"/);
assert.match(list, /name="q" defaultValue=\{search\}/);
assert.match(list, /buildAdminOrderPageHref\(page - 1, search, params\.payment, params\.fulfillment\)/);
assert.match(list, /buildAdminOrderPageHref\(page \+ 1, search, params\.payment, params\.fulfillment\)/);
assert.match(list, /!error && count !== 0 && <nav/);
assert.match(list, /error \? <AdminQueryError/);
assert.match(orderListHelper, /if \(search\) params\.set\("q", search\)/);
assert.match(orderListHelper, /if \(payment\) params\.set\("payment", payment\)/);
assert.match(orderListHelper, /if \(fulfillment\) params\.set\("fulfillment", fulfillment\)/);

function loadTypescript(source) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, URLSearchParams });
  return module.exports;
}

const { buildAdminOrderPageHref, escapePostgrestSearchTerm } = loadTypescript(orderListHelper);
assert.equal(
  buildAdminOrderPageHref(3, "VNT-1 & user", "PAID", "SUBMITTED"),
  "/admin/orders?q=VNT-1+%26+user&payment=PAID&fulfillment=SUBMITTED&page=3",
);
assert.equal(buildAdminOrderPageHref(1, "", undefined, undefined), "/admin/orders?page=1");
assert.equal(escapePostgrestSearchTerm('id",target_value.ilike.*'), 'id\\",target_value.ilike.*');

const { formatOrderInputValue } = loadTypescript(formatterSource);
assert.equal(formatOrderInputValue({ comment: "a comment", url: "https://example.test" }), '{"comment":"a comment","url":"https://example.test"}');
assert.equal(formatOrderInputValue({ lines: ["first comment", "second comment"] }), "first comment\nsecond comment");
assert.doesNotMatch(formatOrderInputValue({ nested: { value: "safe" } }), /\[object Object\]/);

console.log("admin-order-readiness-tests: passed");
