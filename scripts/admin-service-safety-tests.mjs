import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const createRoute = fs.readFileSync("app/api/admin/services/route.ts", "utf8");
const createCard = fs.readFileSync("app/admin/services/CreateServiceCard.tsx", "utf8");
const deleteRoute = fs.readFileSync("app/api/admin/services/[serviceId]/route.ts", "utf8");

function loadTypeScript(path, dependencies) {
  const compiled = ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require(specifier) {
      if (specifier in dependencies) return dependencies[specifier];
      throw new Error(`Unexpected import ${specifier} in ${path}`);
    },
  });
  return module.exports;
}

function createDatabase(seed = {}, options = {}) {
  const tables = {
    platforms: [{ id: "platform-1", name: "Instagram", slug: "instagram", active: true }],
    services: [],
    provider_catalog_services: [{
      provider: "reliablesmm",
      provider_service_id: "7486",
      name: "Instagram Video Views",
      provider_rate: "2.5",
      provider_currency: "USD",
      rate_unit: "PER_1000",
      min_quantity: 100,
      max_quantity: 50000,
      provider_status: "ACTIVE",
      raw_metadata: { service: "7486", name: "Instagram Video Views", platform: "instagram", target_type: "url", category: "Instagram Services" },
    }],
    orders: [],
    service_input_fields: [],
    service_provider_input_mappings: [],
    pricing_audit_log: [],
    provider_mapping_audit: [],
    ...seed,
  };
  let writes = 0;

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.operation = "select";
      this.payload = null;
      this.options = {};
    }
    select(_columns, options = {}) { this.options = options; return this; }
    eq(column, value) { this.filters.push((row) => String(row[column]) === String(value)); return this; }
    insert(payload) { this.operation = "insert"; this.payload = payload; return this; }
    update(payload) { this.operation = "update"; this.payload = payload; return this; }
    delete() { this.operation = "delete"; return this; }
    matches(row) { return this.filters.every((filter) => filter(row)); }
    execute() {
      if (options.queryErrors?.[this.table]) return { data: null, count: null, error: options.queryErrors[this.table] };
      const rows = tables[this.table] ?? [];
      if (this.operation === "select") {
        const matching = rows.filter((row) => this.matches(row));
        return this.options.head ? { data: null, count: matching.length, error: null } : { data: matching, count: matching.length, error: null };
      }
      writes++;
      if (this.operation === "insert") {
        const row = { id: "created-service", ...this.payload };
        rows.push(row);
        return { data: [row], count: 1, error: null };
      }
      const matching = rows.filter((row) => this.matches(row));
      if (this.operation === "update") {
        for (const row of matching) Object.assign(row, this.payload);
      } else if (this.operation === "delete") {
        tables[this.table] = rows.filter((row) => !this.matches(row));
      }
      return { data: matching, count: matching.length, error: null };
    }
    maybeSingle() {
      const result = this.execute();
      return Promise.resolve({ ...result, data: result.data?.[0] ?? null });
    }
    single() {
      const result = this.execute();
      return Promise.resolve({ ...result, data: result.data?.[0] ?? null });
    }
    then(resolve, reject) { return Promise.resolve(this.execute()).then(resolve, reject); }
  }

  return {
    tables,
    get writes() { return writes; },
    from(table) { return new Query(table); },
    async rpc(name, args) {
      if (name !== "apply_provider_mapping") throw new Error(`Unexpected RPC ${name}`);
      if (options.mappingError) return { data: null, error: options.mappingError };
      const service = tables.services.find((row) => row.id === args.p_service_id);
      Object.assign(service, {
        provider: args.p_provider,
        provider_service_id: args.p_provider_service_id,
        provider_rate: "2.5",
        provider_rate_unit: "PER_1000",
        provider_currency: "USD",
      });
      tables.provider_mapping_audit.push({ service_id: service.id, new_provider: args.p_provider, new_provider_service_id: args.p_provider_service_id });
      return {
        data: [{
          service_id: service.id,
          provider: args.p_provider,
          provider_service_id: args.p_provider_service_id,
        }],
        error: null,
      };
    },
  };
}

function loadRoutes(db, { eligible = true } = {}) {
  const next = { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } };
  const auth = { requireAdmin: async () => ({ user: { id: "admin-1" }, admin: true }) };
  const supabase = { createSupabaseAdminClient: () => db };
  const customerPricing = loadTypeScript("lib/pricing/customer-price.ts");
  const creation = loadTypeScript("lib/admin/service-creation.ts", {
    "../pricing/customer-price": customerPricing,
  });
  const compatibility = {
    resolveProviderCompatibility: () => ({ compatibility: { platform: "instagram", targetType: "url" } }),
    resolveProviderPlatformCompatibility: () => ({ state: "READY" }),
    matchesApprovedProviderOperation: () => true,
  };
  const eligibility = {
    assessProviderEligibility: () => eligible ? { status: "ELIGIBLE", reason: "reviewed" } : { status: "BLOCKED", reason: "incompatible operation" },
  };
  const targets = { getTargetContractForService: () => "INSTAGRAM_CONTENT" };
  const common = {
    "next/server": next,
    "../../../../../lib/admin/auth": auth,
    "../../../../lib/admin/auth": auth,
    "../../../../../lib/supabase/server": supabase,
    "../../../../lib/supabase/server": supabase,
  };
  const create = loadTypeScript("app/api/admin/services/route.ts", {
    ...common,
    "../../../../lib/admin/service-creation": creation,
    "../../../../lib/admin/provider-compatibility": compatibility,
    "../../../../lib/targets/eligibility": eligibility,
    "../../../../lib/targets/contracts": targets,
  });
  const remove = loadTypeScript("app/api/admin/services/[serviceId]/route.ts", common);
  return { create: create.POST, remove: remove.DELETE };
}

const validCreateBody = {
  platformId: "platform-1",
  name: "Instagram Video Views",
  category: "Standard",
  description: "",
  serviceType: "standard",
  targetType: "url",
  minQuantity: "100",
  maxQuantity: "50000",
  sellingPricePer1000: "1.500",
  currency: "GHS",
  providerServiceId: "7486",
};
const request = (body) => ({ json: async () => body });

assert.match(createRoute, /assessProviderEligibility\(/, "service creation uses the shared provider eligibility rules");
assert.match(createRoute, /matchesApprovedProviderOperation\(/, "service creation requires a reviewed provider operation");
assert.match(createRoute, /provider_service_id,name,provider_rate,provider_currency,rate_unit,min_quantity,max_quantity,provider_status,raw_metadata/);
assert.match(createRoute, /p_provider_service_id: providerServiceId/);
assert.match(createRoute, /db\.rpc\("apply_provider_mapping"/, "the selected provider mapping is persisted through the existing RPC");
assert.match(createRoute, /mappingResult\?\.provider === "reliablesmm"/);
assert.match(createRoute, /String\(mappingResult\?\.provider_service_id \?\? ""\) === providerServiceId/);
assert.match(createRoute, /persisted\.provider !== "reliablesmm"/);
assert.match(createRoute, /String\(persisted\.provider_service_id \?\? ""\) !== providerServiceId/);
assert.match(createRoute, /active: false/);
assert.match(createRoute, /Provider mapping could not be saved/);
assert.match(createRoute, /provider mapping could not be verified/i);
assert.match(createCard, /body\.mapping\?\.provider === "reliablesmm"/);
assert.match(createCard, /Service creation returned without a verified provider mapping/);
assert.match(createCard, /createdInfo\.mapped/);

const dependencyErrorCheck = deleteRoute.indexOf("if (service.error || orders.error || inputFields.error || inputMappings.error || pricingAudit.error || mappingAudit.error)");
const writes = [
  deleteRoute.indexOf('.from("services")\n      .update'),
  deleteRoute.indexOf('.from("services")\n    .delete'),
].filter((index) => index >= 0);
const firstWrite = Math.min(...writes);
assert.notEqual(dependencyErrorCheck, -1, "every dependency query failure is handled");
assert.ok(firstWrite > dependencyErrorCheck, "dependency query failures stop before all writes");
for (const table of ["orders", "service_input_fields", "service_provider_input_mappings", "pricing_audit_log", "provider_mapping_audit"]) {
  assert.match(deleteRoute, new RegExp(`from\\("${table}"\\).*count: "exact"`, "s"));
}
assert.match(deleteRoute, /\.update\(\{ active: false \}\)/, "protected services are deactivated");
assert.match(deleteRoute, /hasProtectedDependencies/);
assert.match(deleteRoute, /deleted: true/);
assert.doesNotMatch(deleteRoute, /\.from\("(?:pricing_audit_log|provider_mapping_audit|service_input_fields|service_provider_input_mappings)"\)\s*\.delete/);
assert.doesNotMatch(deleteRoute, /from\("service_input_mappings"\)/, "the route does not use the nonexistent legacy mapping table");

{
  const db = createDatabase();
  const routes = loadRoutes(db);
  const response = await routes.create(request(validCreateBody));
  assert.equal(response.status, 201);
  assert.equal(response.body.service.provider, "reliablesmm");
  assert.equal(response.body.service.provider_service_id, "7486");
  assert.equal(db.tables.services[0].selling_rate, "0.0015", "admin per-1,000 price is stored as a per-unit rate");
  assert.equal(db.tables.services[0].active, false);
  assert.equal(db.tables.provider_mapping_audit.length, 1);
}
{
  const db = createDatabase();
  const routes = loadRoutes(db, { eligible: false });
  const response = await routes.create(request(validCreateBody));
  assert.equal(response.status, 409);
  assert.equal(db.tables.services.length, 0);
}
{
  const db = createDatabase({}, { mappingError: new Error("mapping write failed") });
  const routes = loadRoutes(db);
  const response = await routes.create(request(validCreateBody));
  assert.equal(response.status, 500);
  assert.equal(db.tables.services.length, 0, "mapping persistence failure rolls back the new service");
  assert.equal(response.body.service, undefined);
}
{
  const db = createDatabase({}, { queryErrors: { orders: new Error("count failed") } });
  const routes = loadRoutes(db);
  const response = await routes.remove(new Request("http://test"), { params: Promise.resolve({ serviceId: "service-1" }) });
  assert.equal(response.status, 500);
  assert.equal(db.writes, 0, "dependency query errors prevent every write");
}
{
  const db = createDatabase({
    services: [{ id: "service-1", active: true }],
    orders: [{ id: "order-1", service_id: "service-1" }],
    pricing_audit_log: [{ id: "price-history-1", service_id: "service-1" }],
    provider_mapping_audit: [{ id: "mapping-history-1", service_id: "service-1" }],
  });
  const routes = loadRoutes(db);
  const response = await routes.remove(new Request("http://test"), { params: Promise.resolve({ serviceId: "service-1" }) });
  assert.equal(response.body.deactivated, true);
  assert.equal(db.tables.services[0].active, false);
  assert.equal(db.tables.services.length, 1, "a service with protected dependencies is not hard-deleted");
  assert.equal(db.tables.pricing_audit_log.length, 1);
  assert.equal(db.tables.provider_mapping_audit.length, 1);
}
{
  const db = createDatabase({
    services: [{ id: "service-1", active: true, provider: "reliablesmm", provider_service_id: "7486" }],
  });
  const routes = loadRoutes(db);
  const response = await routes.remove(new Request("http://test"), { params: Promise.resolve({ serviceId: "service-1" }) });
  assert.equal(response.body.deactivated, true);
  assert.equal(db.tables.services.length, 1, "a configured provider mapping is protected from hard deletion");
  assert.equal(db.tables.services[0].active, false);
}
{
  const db = createDatabase({
    services: [{ id: "service-1", active: true }],
    pricing_audit_log: [{ id: "price-history-1", service_id: "service-1" }],
    provider_mapping_audit: [{ id: "mapping-history-1", service_id: "service-1" }],
  }, { queryErrors: { pricing_audit_log: new Error("history query failed") } });
  const routes = loadRoutes(db);
  const response = await routes.remove(new Request("http://test"), { params: Promise.resolve({ serviceId: "service-1" }) });
  assert.equal(response.status, 500);
  assert.equal(db.tables.pricing_audit_log.length, 1);
  assert.equal(db.tables.provider_mapping_audit.length, 1);
  assert.equal(db.tables.services[0].active, true);
}
{
  const db = createDatabase({ services: [{ id: "service-1", active: false }] });
  const routes = loadRoutes(db);
  const response = await routes.remove(new Request("http://test"), { params: Promise.resolve({ serviceId: "service-1" }) });
  assert.equal(response.status, 200);
  assert.equal(response.body.deleted, true);
  assert.equal(db.tables.services.length, 0, "an unreferenced inactive service remains hard-deletable");
}

console.log("admin-service-safety-tests: passed");
