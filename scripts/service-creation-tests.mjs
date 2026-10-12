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

const customerPricing = loadTypeScript("lib/pricing/customer-price.ts");
const { slugFromName, validateCreateServiceInput } = loadTypeScript(
  "lib/admin/service-creation.ts",
  { "../pricing/customer-price": customerPricing },
);

const valid = { platformId: "platform-1", name: "  New Likes  ", category: "Likes", description: "", serviceType: "standard", targetType: "url", minQuantity: "100", maxQuantity: "100000", sellingPricePer1000: "5", currency: "GHS" };
assert.equal(slugFromName(valid.name), "new-likes");
assert.equal(validateCreateServiceInput(valid).slug, "new-likes");
assert.equal(validateCreateServiceInput(valid).sellingRatePerUnit, "0.005");
for (const field of ["platformId", "name", "category", "serviceType", "targetType", "minQuantity", "maxQuantity", "sellingPricePer1000"]) { const input = { ...valid, [field]: "" }; assert.throws(() => validateCreateServiceInput(input)); }
assert.throws(() => validateCreateServiceInput({ ...valid, targetType: "unknown" }));
assert.throws(() => validateCreateServiceInput({ ...valid, minQuantity: "10", maxQuantity: "1" }));
assert.throws(() => validateCreateServiceInput({ ...valid, sellingPricePer1000: "0" }));
assert.throws(() => validateCreateServiceInput({ ...valid, sellingPricePer1000: "1.0001" }));
assert.throws(() => validateCreateServiceInput({ ...valid, sellingPricePer1000: "NaN" }));
assert.throws(() => validateCreateServiceInput({ ...valid, currency: "USD" }));
console.log("service-creation-tests: passed");
