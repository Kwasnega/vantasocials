import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadTypeScript(path, dependencies = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require(specifier) {
      if (specifier in dependencies) return dependencies[specifier];
      throw new Error(`Unexpected import ${specifier}`);
    },
  });
  return module.exports;
}

const engine = loadTypeScript("lib/pricing/engine.ts");
const { derivePricing } = loadTypeScript("lib/admin/pricing.ts", {
  "../pricing/engine": engine,
});

const service = {
  id: "service-1",
  slug: "sample",
  name: "Sample",
  selling_rate: "0.005",
  currency: "GHS",
  provider: "reliablesmm",
  provider_service_id: "1",
  provider_rate: "0",
  provider_rate_unit: "PER_1000",
  provider_currency: "USD",
  provider_rate_last_synced: null,
  min_quantity: 1,
  max_quantity: 50000,
  active: true,
};

const zeroStringRate = derivePricing(service, "12");
assert.equal(zeroStringRate.status, "AVAILABLE");
assert.equal(zeroStringRate.per1000.providerCostGhs, "0");
assert.equal(zeroStringRate.per1000.grossProfitGhs, "5");
assert.equal(zeroStringRate.per1000.markupPercent, null);

const zeroNumberRate = derivePricing({ ...service, provider_rate: 0 }, "12");
assert.equal(zeroNumberRate.status, "AVAILABLE");
assert.equal(zeroNumberRate.per1000.providerCostGhs, "0");

assert.equal(derivePricing({ ...service, provider_rate: null }, "12").status, "UNAVAILABLE");
assert.match(derivePricing({ ...service, provider_rate: "not-a-rate" }, "12").reason, /Invalid monetary value/);
assert.match(derivePricing({ ...service, provider_rate_unit: "UNKNOWN" }, "12").reason, /unsupported/);
assert.match(derivePricing(service, "0").reason, /greater than zero/i);
assert.match(derivePricing(service, "12.1234567890123").reason, /precision/);

const precise = derivePricing({
  ...service,
  provider_rate: "0.0000009",
  provider_rate_unit: "PER_1000",
}, "12.123456789012");
assert.equal(precise.status, "AVAILABLE");
assert.equal(precise.per1000.providerCostUsd, "0.0000009");
assert.equal(precise.per1000.providerCostGhs, "0.000010911111");

console.log("admin-pricing-view-model-tests: passed");
