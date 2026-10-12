import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadTypeScript(source, dependencies = {}) {
  const compiled = ts.transpileModule(source, {
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

const customerPricing = loadTypeScript(fs.readFileSync("lib/pricing/customer-price.ts", "utf8"));
const engine = loadTypeScript(fs.readFileSync("lib/pricing/engine.ts", "utf8"));
const serviceCreation = loadTypeScript(
  fs.readFileSync("lib/admin/service-creation.ts", "utf8"),
  { "../pricing/customer-price": customerPricing },
);
const catalog = loadTypeScript(
  fs.readFileSync("lib/fulfillment/reliablesmm/catalog.ts", "utf8"),
  { "server-only": {}, "./client": {} },
);
const catalogServicesSource = fs.readFileSync("lib/catalog/services.ts", "utf8");

const {
  adminPricePer1000ToUnitRate,
  unitRateToAdminPricePer1000,
  normalizeInternalUnitRate,
  calculateCustomerTotal,
  assertPayableOrderTotal,
} = customerPricing;
const perUnitRate = adminPricePer1000ToUnitRate("5.000", false);
assert.equal(perUnitRate, "0.005");
assert.equal(unitRateToAdminPricePer1000(perUnitRate), "5");
assert.deepEqual(
  [1000, 2000, 5000, 10000].map((quantity) => calculateCustomerTotal(perUnitRate, quantity)),
  ["5.00", "10.00", "25.00", "50.00"],
);
assert.equal(adminPricePer1000ToUnitRate("0.001"), "0.000001", "three admin decimals fit six-decimal per-unit storage exactly");
assert.equal(adminPricePer1000ToUnitRate("999999999999999.999"), "999999999999.999999");
assert.throws(() => adminPricePer1000ToUnitRate("1.0001"), /at most 3 decimal places/);
assert.throws(() => adminPricePer1000ToUnitRate("-1"), /non-negative decimal/);
assert.throws(() => adminPricePer1000ToUnitRate("Infinity"), /non-negative decimal/);
assert.throws(() => adminPricePer1000ToUnitRate("1000000000000000"), /supported storage range/);
assert.throws(() => adminPricePer1000ToUnitRate("0", false), /greater than zero/);
assert.equal(calculateCustomerTotal("0.005", 1), "0.01", "currency rounding remains half-up to cents");
assert.equal(normalizeInternalUnitRate("0.005"), "0.005");
assert.equal(normalizeInternalUnitRate(0.005), "0.005");
assert.equal(unitRateToAdminPricePer1000(0.005), "5");
assert.equal(calculateCustomerTotal(0.005, 1000), "5.00");
assert.throws(() => normalizeInternalUnitRate(Number.POSITIVE_INFINITY), /finite non-negative/);
assert.throws(() => normalizeInternalUnitRate(-0.005), /finite non-negative/);
assert.throws(() => normalizeInternalUnitRate(0.0050000001), /represented exactly/);
assert.throws(() => normalizeInternalUnitRate(10000000000), /represented exactly/);

{
  const rows = [
    { id: "numeric", platform_id: "p1", name: "Numeric", slug: "numeric", category: "Likes", description: null, service_type: "standard", target_type: "url", min_quantity: 100, max_quantity: 10000, selling_rate: 0.005, currency: "GHS", active: true },
    { id: "text", platform_id: "p1", name: "Text", slug: "text", category: "Likes", description: null, service_type: "standard", target_type: "url", min_quantity: 100, max_quantity: 10000, selling_rate: "0.005", currency: "GHS", active: true },
  ];
  const query = {
    select() { return this; },
    order() { return this; },
    eq() { return this; },
    async maybeSingle() { return { data: rows[0], error: null }; },
    then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
  };
  const catalogServices = loadTypeScript(catalogServicesSource, {
    "server-only": {},
    "../supabase/server": { createSupabaseServerClient: async () => ({ from: () => query }) },
    "../pricing/customer-price": customerPricing,
  });
  const services = await catalogServices.getServices();
  assert.deepEqual(services.map(({ selling_rate }) => selling_rate), ["0.005", "0.005"]);
  assert.deepEqual(services.map(({ selling_rate }) => calculateCustomerTotal(selling_rate, 1000)), ["5.00", "5.00"]);
  const service = await catalogServices.getService("numeric");
  assert.equal(service.selling_rate, "0.005", "the service-detail loader normalizes numeric rates too");
}

assert.doesNotThrow(() => assertPayableOrderTotal("0.01"));
assert.doesNotThrow(() => assertPayableOrderTotal(0.01));
assert.doesNotThrow(() => assertPayableOrderTotal("9999999999999998.00"));
assert.throws(() => assertPayableOrderTotal("0.00"), /at least GHS 0\.01/);
assert.throws(() => assertPayableOrderTotal("10000000000000000.00"), /supported GHS amount range/);
assert.throws(() => assertPayableOrderTotal("9999999999999998.01"), /safely represented/);

const service = serviceCreation.validateCreateServiceInput({
  platformId: "platform-1",
  name: "Likes",
  category: "Likes",
  description: "",
  serviceType: "standard",
  targetType: "url",
  minQuantity: "100",
  maxQuantity: "100000",
  sellingPricePer1000: "5",
  currency: "GHS",
});
assert.equal(service.sellingRatePerUnit, "0.005");

for (const unit of ["PER_1000", "PER_ORDER"]) {
  const economics = engine.calculatePricing({
    providerRate: "2.5",
    providerRateUnit: unit,
    providerCurrency: "USD",
    fxRate: "12",
    sellingPricePerUnit: perUnitRate,
    sellingCurrency: "GHS",
    quantity: 2000,
  });
  assert.equal(economics.revenueGhs, "10", `${unit} provider billing does not change customer revenue`);
  assert.equal(economics.providerCostUsd, unit === "PER_1000" ? "5" : "2.5");
  assert.equal(economics.providerCostGhs, unit === "PER_1000" ? "60" : "30");
}
const fxBefore = engine.calculatePricing({
  providerRate: "2.5", providerRateUnit: "PER_ORDER", providerCurrency: "USD",
  fxRate: "10", sellingPricePerUnit: perUnitRate, sellingCurrency: "GHS", quantity: 2000,
});
const fxAfter = engine.calculatePricing({
  providerRate: "2.5", providerRateUnit: "PER_ORDER", providerCurrency: "USD",
  fxRate: "12", sellingPricePerUnit: perUnitRate, sellingCurrency: "GHS", quantity: 2000,
});
assert.equal(fxBefore.revenueGhs, fxAfter.revenueGhs, "FX does not change GHS customer pricing");
assert.notEqual(fxBefore.providerCostGhs, fxAfter.providerCostGhs, "FX changes provider cost estimates in GHS");
assert.equal(fxAfter.providerCostUsd, "2.5");
assert.throws(() => engine.calculatePricing({
  providerRate: "2.5", providerRateUnit: "UNKNOWN", providerCurrency: "USD",
  fxRate: "12", sellingPricePerUnit: perUnitRate, sellingCurrency: "GHS", quantity: 2000,
}), /Unsupported provider pricing unit/);

const normalize = (pricingUnit) => catalog.normalizeReliableSMMService({
  service: 7486, name: "Instagram views", rate: "2.5", min: 100, max: 10000,
  ...(pricingUnit === undefined ? {} : { pricingUnit }),
});
assert.equal(normalize("per_1000").pricingUnit, "per_1000");
assert.equal(normalize("per_order").pricingUnit, "per_order");
assert.equal(normalize(undefined).pricingUnit, "unknown");
assert.equal(normalize("per_user").pricingUnit, "unknown");

const source = (path) => fs.readFileSync(path, "utf8");
const createApi = source("app/api/admin/services/route.ts");
const mappingApi = source("app/api/admin/mappings-and-pricing/route.ts");
const patchApi = source("app/api/admin/pricing/[slug]/route.ts");
const previewApi = source("app/api/admin/pricing/preview/route.ts");
const createUi = source("app/admin/services/CreateServiceCard.tsx");
const mappingUi = source("app/admin/services/MappingControl.tsx");
const configurator = source("components/services/ServiceConfigurator.tsx");
const publicCatalog = source("components/catalog/PlatformCatalog.tsx");
const orderApi = source("app/api/orders/route.ts");
const syncApi = source("app/api/admin/pricing/sync/route.ts");
const reliableAttempt = source("lib/fulfillment/reliablesmm/attempt.ts");
const checkout = source("app/checkout/page.tsx");
const walletPaymentApi = source("app/api/payments/wallet/route.ts");
const paystackInitializeApi = source("app/api/payments/initialize/route.ts");
const paystackSettlement = source("lib/payments/settle.ts");
const fulfillmentWorker = source("lib/fulfillment/worker.ts");

assert.match(createUi, /Customer Price \(GHS per 1,000 units\)/);
assert.match(createApi, /selling_rate: input\.sellingRatePerUnit/);
assert.match(mappingUi, /VANTA CUSTOMER SELLING PRICE \(GHS PER 1,000 UNITS\)/);
assert.match(mappingApi, /adminPricePer1000ToUnitRate\(sellingPricePer1000, false\)/);
assert.match(mappingApi, /\.update\(\{ selling_rate: sellingRatePerUnit \}\)/);
assert.match(patchApi, /adminPricePer1000ToUnitRate\(sellingPricePer1000\)/);
assert.match(patchApi, /\.update\(\{ selling_rate: sellingRatePerUnit \}\)/);
assert.match(previewApi, /adminPricePer1000ToUnitRate\(sellingPricePer1000\)/);
assert.match(configurator, /calculateCustomerTotal\(service\.selling_rate, quantity\)/);
assert.match(publicCatalog, /calculateCustomerTotal\(service\.selling_rate, 1000\)/);
assert.match(orderApi, /normalizeInternalUnitRate\(service\.selling_rate\)/);
assert.match(orderApi, /calculateCustomerTotal\(unitPrice, quantity\)/);
assert.match(orderApi, /assertPayableOrderTotal\(subtotal\)/);
assert.match(orderApi, /unit_price: unitPrice/);
assert.match(orderApi, /total: subtotal/);
assert.match(checkout, /checkoutOrder\.total/);
assert.match(paystackInitializeApi, /assertPayableOrderTotal\(order\.total\)/);
assert.match(walletPaymentApi, /assertPayableOrderTotal\(order\.total\)/);
assert.match(paystackSettlement, /assertPayableOrderTotal\(order\.total\)/);
assert.match(fulfillmentWorker, /assertPayableOrderTotal\(order\.total\)/);
assert.ok(
  walletPaymentApi.indexOf("assertPayableOrderTotal(order.total)") < walletPaymentApi.indexOf('admin.rpc("debit_wallet_for_order"'),
  "wallet debit is unreachable for a non-payable order total",
);
assert.ok(
  paystackInitializeApi.indexOf("assertPayableOrderTotal(order.total)") < paystackInitializeApi.indexOf('.from("payments").insert'),
  "Paystack payment reservation is unreachable for a non-payable order total",
);
assert.match(syncApi, /normalizeReliableSMMService\(provider\)/);
assert.match(syncApi, /if \(!providerRateUnit \|\| normalizedProvider\.currency !== "USD"\)/);
assert.doesNotMatch(syncApi, /provider_rate_unit: "PER_1000"/);
assert.match(reliableAttempt, /reliableSMMCost\(rate, input\.quantity, approvedCatalog\.rate_unit\)/);
assert.match(reliableAttempt, /provider_cost: providerCost, currency: "USD"/);

function mockAdminDb() {
  const tables = {
    services: [{
      id: "service-1", slug: "instagram-likes", name: "Likes", selling_rate: "0.001",
      currency: "GHS", provider: null, provider_service_id: null, min_quantity: 100,
      max_quantity: 10000, target_type: "url", platforms: { slug: "instagram", name: "Instagram" },
    }],
    provider_catalog_services: [{
      provider: "reliablesmm", provider_service_id: "7486", name: "Instagram Likes",
      provider_rate: "2.5", provider_currency: "USD", rate_unit: "PER_1000",
      provider_status: "ACTIVE", min_quantity: 100, max_quantity: 10000,
      raw_metadata: { platform: "instagram", target_type: "url", category: "Instagram Likes" },
    }],
    pricing_settings: [{ key: "USD_GHS", fx_rate: "12" }],
    pricing_audit_log: [],
    provider_mapping_audit: [],
  };
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.operation = "select"; this.payload = null; }
    select() { return this; }
    eq(key, value) { this.filters.push([key, String(value)]); return this; }
    update(payload) { this.operation = "update"; this.payload = payload; return this; }
    insert(payload) { this.operation = "insert"; this.payload = payload; return this; }
    execute() {
      const rows = tables[this.table] ?? [];
      const matches = rows.filter((row) => this.filters.every(([key, value]) => String(row[key]) === value));
      if (this.operation === "select") return { data: matches, error: null };
      if (this.operation === "insert") {
        const row = { ...this.payload, id: `${this.table}-${rows.length + 1}` };
        rows.push(row);
        return { data: [row], error: null };
      }
      for (const row of matches) Object.assign(row, this.payload);
      return { data: matches, error: null };
    }
    maybeSingle() { return Promise.resolve({ ...this.execute(), data: this.execute().data?.[0] ?? null }); }
    single() { return this.maybeSingle(); }
    then(resolve, reject) { return Promise.resolve(this.execute()).then(resolve, reject); }
  }
  return {
    tables,
    from: (table) => new Query(table),
    async rpc(name, args) {
      assert.equal(name, "apply_provider_mapping");
      const service = tables.services.find((row) => row.id === args.p_service_id);
      service.provider = args.p_provider;
      service.provider_service_id = args.p_provider_service_id;
      return { data: [{ service_id: service.id, provider: service.provider, provider_service_id: service.provider_service_id }], error: null };
    },
  };
}

const mockAdminAuth = { requireAdmin: async () => ({ user: { id: "admin-1" }, admin: true }) };
const mockRateLimit = { enforceAdminRateLimit: async () => null, limiterUnavailable: () => null };
const mockEligibility = { assessProviderEligibility: () => ({ status: "ELIGIBLE", reason: "reviewed" }) };
const mockCompatibility = {
  matchesApprovedProviderOperation: () => true,
  resolveProviderCompatibility: () => ({ compatibility: { targetType: "url" } }),
  resolveProviderPlatformCompatibility: () => ({ state: "READY" }),
};
const mockTargets = { getTargetContractForService: () => "INSTAGRAM_CONTENT" };

{
  const db = mockAdminDb();
  const route = loadTypeScript(source("app/api/admin/mappings-and-pricing/route.ts"), {
    "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } },
    "../../../../lib/admin/auth": mockAdminAuth,
    "../../../../lib/supabase/server": { createSupabaseAdminClient: () => db },
    "../../../../lib/pricing/engine": engine,
    "../../../../lib/pricing/customer-price": customerPricing,
    "../../../../lib/security/rate-limit": mockRateLimit,
    "../../../../lib/targets/eligibility": mockEligibility,
    "../../../../lib/targets/contracts": mockTargets,
    "../../../../lib/admin/provider-compatibility": mockCompatibility,
  });
  const response = await route.POST({ json: async () => ({ service_id: "service-1", provider_service_id: "7486", sellingPricePer1000: "5" }) });
  assert.equal(response.status, 200);
  assert.equal(db.tables.services[0].selling_rate, "0.005", "mapping/pricing API converts once before persistence");
  assert.equal(db.tables.pricing_audit_log[0].new_value, "0.005");
}

{
  const db = mockAdminDb();
  const route = loadTypeScript(source("app/api/admin/pricing/[slug]/route.ts"), {
    "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } },
    "../../../../../lib/admin/auth": mockAdminAuth,
    "../../../../../lib/supabase/server": { createSupabaseAdminClient: () => db },
    "../../../../../lib/security/rate-limit": mockRateLimit,
    "../../../../../lib/pricing/customer-price": customerPricing,
  });
  const response = await route.PATCH(
    { json: async () => ({ sellingPricePer1000: "5" }) },
    { params: Promise.resolve({ slug: "instagram-likes" }) },
  );
  assert.equal(response.status, 200);
  assert.equal(db.tables.services[0].selling_rate, "0.005", "pricing PATCH converts once before persistence");
  assert.equal(db.tables.pricing_audit_log[0].new_value, "0.005");
}

console.log("pricing-contract-tests: passed");
