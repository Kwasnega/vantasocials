import assert from "node:assert/strict";
import { resolveOrderExecutionMode } from "../lib/fulfillment/order-execution-mode.ts";
import { buildProviderPayload } from "../lib/fulfillment/provider-input-transform.ts";
import { buildReliableSMMProviderRequest } from "../lib/fulfillment/reliablesmm/request.ts";

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
  providerServiceId: "7486",
  inputSchemaVersion: 3,
  inputSchemaSnapshot: [{ key: "username", label: "Username", inputType: "username", required: true, displayOrder: 1, validation: { maxLength: 64 }, schemaVersion: 3, active: true }, { key: "url", label: "URL", inputType: "url", required: true, displayOrder: 2, validation: { maxLength: 2048 }, schemaVersion: 3, active: true }],
  inputValues: { username: "  alice  ", url: "https://example.com/path?x=1#fragment" },
}, [
  { service_id: "svc_1", provider: "reliablesmm", provider_service_id: "7486", provider_parameter_key: "username", transform_id: "trim", transform_version: 1, provider_required: true, omit_when_blank: false, active: true, vanta_input_field_key: "username" },
  { service_id: "svc_1", provider: "reliablesmm", provider_service_id: "7486", provider_parameter_key: "link", transform_id: "normalize_url", transform_version: 1, provider_required: true, omit_when_blank: false, active: true, vanta_input_field_key: "url" },
]);
assert.equal(providerPayload.provider, "reliablesmm");
assert.equal(providerPayload.providerServiceId, "7486");
assert.equal(providerPayload.payload.service, "7486");
assert.equal(providerPayload.payload.username, "alice");
assert.equal(providerPayload.payload.link, "https://example.com/path?x=1");

const normalizedRequest = buildReliableSMMProviderRequest({
  providerServiceId: "7486",
  quantity: 100,
  targetValue: "https://example.com/path?x=1",
  payload: { service: "7486", link: "https://example.com/path?x=1", username: "alice", quantity: 100, action: "add", provider: "evil" },
});
assert.equal(normalizedRequest.providerServiceId, "7486");
assert.equal(normalizedRequest.quantity, 100);
assert.equal(normalizedRequest.targetValue, "https://example.com/path?x=1");
assert.equal(normalizedRequest.request.service, 7486);
assert.equal(normalizedRequest.request.quantity, 100);
assert.equal(normalizedRequest.request.link, "https://example.com/path?x=1");
assert.equal(normalizedRequest.request.username, "alice");
assert.equal(Object.prototype.hasOwnProperty.call(normalizedRequest.request, "action"), false);
assert.equal(Object.prototype.hasOwnProperty.call(normalizedRequest.request, "provider"), false);

assert.throws(() => buildReliableSMMProviderRequest({ providerServiceId: "", quantity: 100, targetValue: "https://example.com" }), /incomplete/i);
assert.throws(() => buildReliableSMMProviderRequest({ providerServiceId: "7486", quantity: 100, targetValue: "" }), /missing a target value/i);

console.log("phase37-dynamic-fulfillment-tests: passed");
