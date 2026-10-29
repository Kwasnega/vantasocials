import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { ensureProviderMappingEligibility, extractApprovedProviderParameters, normalizeMappingDraft } from "../lib/admin/service-input-config.ts";
import { buildProviderPayload } from "../lib/fulfillment/provider-input-transform.ts";
import { buildReliableSMMProviderRequest } from "../lib/fulfillment/reliablesmm/request.ts";

const service = {
  id: "views-service",
  slug: "instagram-views",
  target_type: "url",
  min_quantity: 100,
  max_quantity: 100000,
  platforms: { slug: "instagram", name: "Instagram" },
};
const providerService = {
  provider: "reliablesmm",
  provider_service_id: "2039",
  name: "Instagram Video Views",
  provider_status: "ACTIVE",
  provider_rate: "2.5",
  provider_currency: "USD",
  rate_unit: "PER_1000",
  min_quantity: 100,
  max_quantity: 50000,
  raw_metadata: { service: "2039", name: "Instagram Video Views", category: "Instagram Services" },
};
const postUrlField = {
  id: "post-url-field",
  service_id: service.id,
  key: "post_url",
  label: "Post URL",
  input_type: "post_url",
  required: true,
  display_order: 1,
  validation_config: { maxLength: 2048 },
  schema_version: 1,
  active: true,
};

assert.deepEqual(extractApprovedProviderParameters({ service: "2039", name: "Instagram Video Views" }), ["link"]);
assert.deepEqual(
  extractApprovedProviderParameters({ parameters: ["username", "service", "quantity", "link"] }),
  ["username", "link"],
);
assert.throws(
  () => ensureProviderMappingEligibility(service, { ...providerService, raw_metadata: { service: "2039", name: "Instagram Video Views" } }),
  /requires manual review/i,
  "An unreviewed provider service should not be eligible without an explicit admin selection.",
);
assert.equal(ensureProviderMappingEligibility(service, providerService, true).status, "ELIGIBLE");
assert.equal(
  ensureProviderMappingEligibility(service, {
    ...providerService,
    raw_metadata: { service: "2039", name: "Instagram Video Views" },
  }, true).status,
  "ELIGIBLE",
  "Missing optional category/parameter-schema metadata should not block an explicit, name-matched mapping.",
);
assert.throws(
  () => ensureProviderMappingEligibility(service, {
    ...providerService,
    raw_metadata: { service: "2039", name: "Instagram Video Views", platform: "tiktok", target_type: "video_url" },
  }, true),
  /platform does not match/i,
  "Confirmed platform mismatch must remain blocked.",
);

const mapping = normalizeMappingDraft({
  serviceId: service.id,
  provider: "reliablesmm",
  providerServiceId: "2039",
  providerParameterKey: "link",
  transformId: "normalize_url",
  transformVersion: 1,
  providerRequired: true,
  omitWhenBlank: false,
  schemaVersion: 1,
  active: true,
}, postUrlField, service.target_type);
assert.throws(
  () => normalizeMappingDraft({
    serviceId: service.id,
    provider: "reliablesmm",
    providerServiceId: "2039",
    providerParameterKey: "link",
    transformId: "trim",
    transformVersion: 1,
    providerRequired: true,
    omitWhenBlank: false,
    schemaVersion: 1,
    active: true,
  }, postUrlField, service.target_type),
  /normalize_url/i,
);
assert.throws(
  () => normalizeMappingDraft({
    serviceId: service.id,
    provider: "reliablesmm",
    providerServiceId: "2039",
    providerParameterKey: "link",
    transformId: "normalize_url",
    transformVersion: 1,
    providerRequired: true,
    omitWhenBlank: false,
    schemaVersion: 1,
    active: true,
  }, { ...postUrlField, input_type: "username" }, service.target_type),
  /URL field compatible with the VANTA service target/i,
);
assert.throws(
  () => normalizeMappingDraft({
    serviceId: service.id,
    provider: "reliablesmm",
    providerServiceId: "2039",
    providerParameterKey: "link",
    transformId: "normalize_url",
    transformVersion: 1,
    providerRequired: true,
    omitWhenBlank: false,
    schemaVersion: 1,
    active: true,
  }, { ...postUrlField, input_type: "video_url" }, service.target_type),
  /URL field compatible with the VANTA service target/i,
);

const transformed = buildProviderPayload({
  orderId: "order-1",
  serviceId: service.id,
  provider: "reliablesmm",
  providerServiceId: "2039",
  inputSchemaVersion: 1,
  inputSchemaSnapshot: [{
    key: "post_url",
    label: "Post URL",
    inputType: "post_url",
    required: true,
    displayOrder: 1,
    validation: { maxLength: 2048 },
    schemaVersion: 1,
    active: true,
  }],
  inputValues: { post_url: " https://www.instagram.com/reel/ABC123/#fragment " },
}, [{
  service_id: service.id,
  provider: "reliablesmm",
  provider_service_id: "2039",
  provider_parameter_key: mapping.providerParameterKey,
  transform_id: mapping.transform.id,
  transform_version: mapping.transform.version,
  provider_required: true,
  omit_when_blank: false,
  schema_version: 1,
  active: true,
  vanta_input_field_key: "post_url",
}]);
assert.equal(transformed.providerServiceId, "2039");
assert.equal(transformed.payload.link, "https://www.instagram.com/reel/ABC123/");

const request = buildReliableSMMProviderRequest({
  providerServiceId: transformed.providerServiceId,
  quantity: 100,
  targetValue: transformed.payload.link,
  payload: { ...transformed.payload, service: "7486", quantity: 999, link: "https://attacker.example/" },
});
assert.equal(request.providerServiceId, "2039");
assert.equal(request.request.service, 2039);
assert.equal(request.request.quantity, 100);
assert.equal(request.request.link, "https://www.instagram.com/reel/ABC123/");

assert.throws(() => buildProviderPayload({
  orderId: "order-2",
  serviceId: service.id,
  provider: "reliablesmm",
  providerServiceId: "2039",
  inputSchemaVersion: 1,
  inputSchemaSnapshot: [{
    key: "post_url",
    label: "Post URL",
    inputType: "post_url",
    required: true,
    displayOrder: 1,
    validation: { maxLength: 2048 },
    schemaVersion: 1,
    active: true,
  }],
  inputValues: { post_url: "https://www.instagram.com/reel/ABC123/" },
}, [{
  service_id: service.id,
  provider: "reliablesmm",
  provider_service_id: "2039",
  provider_parameter_key: "username",
  transform_id: "trim",
  transform_version: 1,
  provider_required: true,
  omit_when_blank: false,
  schema_version: 1,
  active: true,
  vanta_input_field_key: "username",
}]), /required VANTA field.*missing an approved provider mapping/i);
assert.throws(() => buildProviderPayload({
  orderId: "order-3",
  serviceId: service.id,
  provider: "reliablesmm",
  providerServiceId: "2039",
  inputSchemaVersion: 1,
  inputSchemaSnapshot: [{
    key: "post_url",
    label: "Post URL",
    inputType: "post_url",
    required: true,
    displayOrder: 1,
    validation: { maxLength: 2048 },
    schemaVersion: 1,
    active: true,
  }],
  inputValues: {},
}, [{
  service_id: service.id,
  provider: "reliablesmm",
  provider_service_id: "2039",
  provider_parameter_key: "link",
  transform_id: "normalize_url",
  transform_version: 1,
  provider_required: true,
  omit_when_blank: false,
  schema_version: 1,
  active: true,
  vanta_input_field_key: "post_url",
}]), /Field "post_url" is required/i);

const saveRoute = fs.readFileSync("app/api/admin/services/[serviceId]/input-mappings/route.ts", "utf8");
const getHandler = saveRoute.slice(0, saveRoute.indexOf("export async function POST"));
const postHandler = saveRoute.slice(saveRoute.indexOf("export async function POST"));
assert.doesNotMatch(getHandler, /apply_provider_mapping|update\(\{ active: false \}\)/);
assert.match(postHandler, /p_provider_service_id:\s*catalogServiceId/);
assert.match(postHandler, /apply_provider_mapping/);
assert.match(postHandler, /\.neq\("provider_service_id",\s*catalogServiceId\)/);
assert.match(postHandler, /eligibility,\s*\}\s*,\s*\{ status: 201 \}/);
const adapter = fs.readFileSync("lib/fulfillment/reliablesmm/adapter.ts", "utf8");
const client = fs.readFileSync("lib/fulfillment/reliablesmm/client.ts", "utf8");
assert.match(adapter, /service:\s*Number\(input\.providerServiceId\)/);
assert.match(adapter, /link:\s*input\.targetValue/);
assert.match(adapter, /quantity:\s*input\.quantity/);
assert.match(client, /const ENDPOINT = "https:\/\/reliablesmm\.com\/api\/v2"/);
assert.match(client, /new URLSearchParams\(\{\s*key:\s*apiKey\(\),\s*action,\s*\.\.\.Object\.fromEntries/);
const catalogRoute = fs.readFileSync("app/api/admin/provider-catalog/route.ts", "utf8");
assert.match(catalogRoute, /explicitlyMappedServiceIds\.has\(String\(row\.provider_service_id\)\)/);
const adminServicesPage = fs.readFileSync("app/admin/services/page.tsx", "utf8");
assert.match(adminServicesPage, /reviewedDynamicMappings\.has\(`\$\{service\.id\}:\$\{service\.provider_service_id\}`\)/);

const ui = fs.readFileSync("app/admin/services/[serviceId]/inputs/ServiceInputConfiguration.tsx", "utf8");
assert.match(ui, /setEligibility\(body\.eligibility\)/);
assert.match(ui, /link \(system-managed target\)/);

const oldMapping = {
  id: "old-7486-map",
  service_id: service.id,
  service_input_field_id: "old-field",
  provider: "reliablesmm",
  provider_service_id: "7486",
  provider_parameter_key: "link",
  transform_id: "normalize_url",
  transform_version: 1,
  provider_required: true,
  omit_when_blank: false,
  schema_version: 1,
  active: true,
};
const records = {
  services: [{ ...service, provider: "reliablesmm", provider_service_id: "7486" }],
  service_input_fields: [postUrlField],
  provider_catalog_services: [providerService],
  service_provider_input_mappings: [{ ...oldMapping }],
};
const initialServiceId = records.services[0].provider_service_id;
class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.operation = "select";
    this.payload = null;
  }
  select() { return this; }
  eq(key, value) { this.filters.push((row) => String(row[key]) === String(value)); return this; }
  neq(key, value) { this.filters.push((row) => String(row[key]) !== String(value)); return this; }
  insert(payload) { this.operation = "insert"; this.payload = payload; return this; }
  update(payload) { this.operation = "update"; this.payload = payload; return this; }
  async execute() {
    const rows = records[this.table] ?? [];
    if (this.operation === "insert") {
      const row = { id: "new-2039-map", ...this.payload };
      rows.push(row);
      return { data: row, error: null };
    }
    const matching = rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.operation === "update") for (const row of matching) Object.assign(row, this.payload);
    return { data: matching, error: null };
  }
  async maybeSingle() {
    const result = await this.execute();
    return { data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error };
  }
  async single() {
    const result = await this.execute();
    return { data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error };
  }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
}
const adminDb = {
  from(table) { return new Query(table); },
  async rpc(name, args) {
    assert.equal(name, "apply_provider_mapping");
    const selectedService = records.services.find((row) => row.id === args.p_service_id);
    selectedService.provider = args.p_provider;
    selectedService.provider_service_id = args.p_provider_service_id;
    return {
      data: [{
        service_id: selectedService.id,
        provider: selectedService.provider,
        provider_service_id: selectedService.provider_service_id,
      }],
      error: null,
    };
  },
};
const routeSource = fs.readFileSync("app/api/admin/services/[serviceId]/input-mappings/route.ts", "utf8");
const routeJs = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const routeModule = { exports: {} };
vm.runInNewContext(routeJs, {
  module: routeModule,
  exports: routeModule.exports,
  require(specifier) {
    if (specifier === "next/server") return { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } };
    if (specifier === "../../../../../../lib/admin/auth") return { requireAdmin: async () => ({ user: { id: "admin-1" }, admin: true }) };
    if (specifier === "../../../../../../lib/admin/service-input-config") {
      return { ensureProviderMappingEligibility, extractApprovedProviderParameters, getServiceMappingInsertPayload: (value, serviceId, fieldId) => ({
        service_id: serviceId,
        service_input_field_id: fieldId,
        provider: value.provider,
        provider_service_id: value.providerServiceId,
        provider_parameter_key: value.providerParameterKey,
        transform_id: value.transform.id,
        transform_version: value.transform.version,
        provider_required: value.providerRequired,
        omit_when_blank: value.omitWhenBlank,
        schema_version: value.mappingSchemaVersion,
        active: value.active,
      }), normalizeMappingDraft };
    }
    if (specifier === "../../../../../../lib/fulfillment/reliablesmm/reserved-keys") return {
      isReservedProviderTransportKey: (key) => ["action", "service", "quantity", "link"].includes(String(key).toLowerCase()),
    };
    if (specifier === "../../../../../../lib/supabase/server") return { createSupabaseAdminClient: () => adminDb };
    throw new Error(`Unexpected route import: ${specifier}`);
  },
});
assert.equal(records.services[0].provider_service_id, "7486", "Loading/selecting a service must not replace the existing mapping.");
const routeResult = await routeModule.exports.POST({
  json: async () => ({
    serviceInputFieldId: postUrlField.id,
    provider: "reliablesmm",
    providerServiceId: "2039",
    providerParameterKey: "link",
    transformId: "normalize_url",
    transformVersion: 1,
    providerRequired: true,
    omitWhenBlank: false,
    schemaVersion: 1,
    active: true,
  }),
}, { params: Promise.resolve({ serviceId: service.id }) });
assert.equal(routeResult.status, 201, JSON.stringify(routeResult.body));
assert.equal(routeResult.body.mapping.provider_service_id, "2039");
assert.equal(routeResult.body.mapping.provider_parameter_key, "link");
assert.equal(routeResult.body.mapping.transform_id, "normalize_url");
assert.equal(routeResult.body.eligibility.status, "ELIGIBLE");
assert.equal(records.services[0].provider_service_id, "2039");
assert.equal(records.service_provider_input_mappings.find((row) => row.id === oldMapping.id).active, false);
assert.equal(records.service_provider_input_mappings.find((row) => row.id === "new-2039-map").active, true);

console.log("phase39-reliablesmm-service-input-mapping-tests: passed");
