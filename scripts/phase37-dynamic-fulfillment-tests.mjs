import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveOrderExecutionMode } from "../lib/fulfillment/order-execution-mode.ts";
import { buildProviderPayload } from "../lib/fulfillment/provider-input-transform.ts";
import { buildReliableSMMProviderRequest } from "../lib/fulfillment/reliablesmm/request.ts";
import { normalizePersistedProviderInputMappings } from "../lib/fulfillment/service-input-mapping.ts";

const LEGACY = "LEGACY";
const DYNAMIC_VALID = "DYNAMIC_VALID";
const DYNAMIC_INVALID = "DYNAMIC_INVALID";

function expectMode(order, expected) {
  assert.equal(resolveOrderExecutionMode(order), expected, `Expected ${expected} for ${JSON.stringify(order)}`);
}

expectMode(null, LEGACY);
expectMode({}, LEGACY);
expectMode({ input_schema_version: null, input_schema_snapshot: null, input_values: null }, LEGACY);
expectMode({ input_schema_version: 3, input_schema_snapshot: [{ key: "username" }], input_values: { username: "alice" } }, DYNAMIC_VALID);
expectMode({ input_schema_version: 3, input_schema_snapshot: null, input_values: null }, DYNAMIC_INVALID);
expectMode({ input_schema_version: null, input_schema_snapshot: [{ key: "username" }], input_values: { username: "alice" } }, DYNAMIC_INVALID);
expectMode({ input_schema_version: 3, input_schema_snapshot: [{ key: "username" }], input_values: null }, DYNAMIC_INVALID);
expectMode({ input_schema_version: null, input_schema_snapshot: null, input_values: { username: "alice" } }, DYNAMIC_INVALID);
expectMode({ input_schema_version: "3", input_schema_snapshot: [{ key: "username" }], input_values: { username: "alice" } }, DYNAMIC_INVALID);
expectMode({ input_schema_version: 3, input_schema_snapshot: [], input_values: { username: "alice" } }, DYNAMIC_INVALID);
expectMode({ input_schema_version: 3, input_schema_snapshot: [{ key: "username" }], input_values: {} }, DYNAMIC_INVALID);

const providerPayload = buildProviderPayload({
  orderId: "order_123",
  serviceId: "svc_1",
  provider: "reliablesmm",
  providerServiceId: "2037",
  inputSchemaVersion: 3,
  inputSchemaSnapshot: [{ key: "username", label: "Username", inputType: "username", required: true, displayOrder: 1, validation: { maxLength: 64 }, schemaVersion: 3, active: true }, { key: "url", label: "URL", inputType: "url", required: true, displayOrder: 2, validation: { maxLength: 2048 }, schemaVersion: 3, active: true }],
  inputValues: { username: "  alice  ", url: "https://www.instagram.com/p/canary/?igsh=abc#fragment" },
}, [
  { service_id: "svc_1", provider: "reliablesmm", provider_service_id: "2037", provider_parameter_key: "username", transform_id: "trim", transform_version: 1, provider_required: true, omit_when_blank: false, active: true, vanta_input_field_key: "username" },
  { service_id: "svc_1", provider: "reliablesmm", provider_service_id: "2037", provider_parameter_key: "link", transform_id: "normalize_url", transform_version: 1, provider_required: true, omit_when_blank: false, active: true, vanta_input_field_key: "url" },
]);
assert.equal(providerPayload.provider, "reliablesmm");
assert.equal(providerPayload.providerServiceId, "2037");
assert.equal(providerPayload.payload.service, "2037");
assert.equal(providerPayload.payload.username, "alice");
assert.equal(providerPayload.payload.link, "https://www.instagram.com/p/canary/?igsh=abc");

const schemaBackedMapping = normalizePersistedProviderInputMappings([{
  service_id: "svc_1",
  provider: "reliablesmm",
  provider_service_id: "2037",
  provider_parameter_key: "link",
  transform_id: "normalize_url",
  transform_version: 1,
  provider_required: true,
  omit_when_blank: false,
  schema_version: 3,
  active: true,
  service_input_fields: [{ key: "post_url" }],
}]);
const schemaBackedPayload = buildProviderPayload({
  orderId: "order_123",
  serviceId: "svc_1",
  provider: "reliablesmm",
  providerServiceId: "2037",
  inputSchemaVersion: 1,
  inputSchemaSnapshot: [{ key: "post_url", label: "Post URL", inputType: "post_url", required: true, displayOrder: 1, validation: {}, schemaVersion: 1, active: true }],
  inputValues: { post_url: "https://www.instagram.com/p/canary/" },
}, schemaBackedMapping);
assert.equal(schemaBackedPayload.payload.link, "https://www.instagram.com/p/canary/");

const normalizedRequest = buildReliableSMMProviderRequest({
  providerServiceId: "2037",
  quantity: 100,
  targetValue: providerPayload.payload.link,
  payload: { service: "7486", link: "https://evil.example/", username: "alice", quantity: 100, action: "add", provider: "evil" },
});
assert.equal(normalizedRequest.providerServiceId, "2037");
assert.equal(normalizedRequest.quantity, 100);
assert.equal(normalizedRequest.targetValue, "https://www.instagram.com/p/canary/?igsh=abc");
assert.equal(normalizedRequest.request.service, 2037);
assert.equal(normalizedRequest.request.quantity, 100);
assert.equal(normalizedRequest.request.link, "https://www.instagram.com/p/canary/?igsh=abc");
assert.equal(normalizedRequest.request.username, "alice");
assert.equal(Object.prototype.hasOwnProperty.call(normalizedRequest.request, "action"), false);
assert.equal(Object.prototype.hasOwnProperty.call(normalizedRequest.request, "provider"), false);

assert.throws(() => buildReliableSMMProviderRequest({ providerServiceId: "", quantity: 100, targetValue: "https://example.com" }), /incomplete/i);
assert.throws(() => buildReliableSMMProviderRequest({ providerServiceId: "7486", quantity: 100, targetValue: "" }), /missing a target value/i);

const dynamicAttemptSource = fs.readFileSync("lib/fulfillment/reliablesmm/attempt.ts", "utf8");
const canaryRouteSource = fs.readFileSync("app/api/internal/fulfillment/canary/route.ts", "utf8");
const fulfillmentWorkerSource = fs.readFileSync("lib/fulfillment/worker.ts", "utf8");
assert.match(fulfillmentWorkerSource, /service_input_fields!service_provider_input_mappings_service_field_fk/);
assert.doesNotMatch(fulfillmentWorkerSource, /service_provider_input_mappings[^;]*vanta_input_field_key/);
assert.match(dynamicAttemptSource, /if \(input\.allowLiveSubmission\)/);
assert.match(dynamicAttemptSource, /expectedProviderServiceId: request\.providerServiceId/);
assert.match(canaryRouteSource, /RELIABLESMM_CANARY_ORDER_ID !== CANARY_ORDER_ID/);
assert.match(canaryRouteSource, /CANARY_PROVIDER_SERVICE_ID = "2037"/);
assert.match(canaryRouteSource, /PANELS_LIVE_FULFILLMENT_ENABLED !== "true"/);
assert.match(fulfillmentWorkerSource, /canaryOrderId === input\.orderId/);
assert.match(fulfillmentWorkerSource, /input\.orderId === "6de6cd32-998f-4d61-b4bc-8a6ac4eff5b6"/);
assert.match(fulfillmentWorkerSource, /executionRecord\?\.public_order_id === "VNT-610A68"/);
assert.match(fulfillmentWorkerSource, /orderSpecificAuthorization/);

console.log("phase37-dynamic-fulfillment-tests: passed");
