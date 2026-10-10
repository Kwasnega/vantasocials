import assert from "node:assert/strict";
import { normalizeMappingDraft } from "../lib/admin/service-input-config.ts";
import { buildProviderPayload } from "../lib/fulfillment/provider-input-transform.ts";
import { buildReliableSMMProviderRequest } from "../lib/fulfillment/reliablesmm/request.ts";
import { RELIABLESMM_RESERVED_TRANSPORT_KEYS, isReservedProviderTransportKey } from "../lib/fulfillment/reliablesmm/reserved-keys.ts";

const serviceInputField = {
  key: "username",
  label: "Username",
  inputType: "username",
  required: true,
  displayOrder: 1,
  validation: { rule: "text", config: { maxLength: 64 } },
  schemaVersion: 1,
  active: true,
};

for (const key of ["action", "service", "quantity", "link"]) {
  assert.equal(isReservedProviderTransportKey(key), true, `Expected ${key} to be reserved`);
}
for (const key of ["username", "comments", "channel", "page", "video_url"]) {
  assert.equal(isReservedProviderTransportKey(key), false, `Expected ${key} to be allowed`);
}

const validMapping = {
  serviceId: "svc_1",
  provider: "reliablesmm",
  providerServiceId: "7486",
  providerParameterKey: "username",
  transformId: "trim",
  transformVersion: 1,
  providerRequired: true,
  omitWhenBlank: false,
  schemaVersion: 1,
  active: true,
};

const validCommentsMapping = {
  ...validMapping,
  providerParameterKey: "comments",
  transformId: "normalize_comments",
  transformVersion: 1,
};

assert.doesNotThrow(() => normalizeMappingDraft(validMapping, serviceInputField));
assert.doesNotThrow(() => normalizeMappingDraft(validCommentsMapping, { ...serviceInputField, key: "comments", inputType: "comments" }));
assert.doesNotThrow(() => normalizeMappingDraft({ ...validMapping, providerParameterKey: "channel" }, { ...serviceInputField, key: "channel", inputType: "channel" }));
assert.doesNotThrow(() => normalizeMappingDraft({ ...validMapping, providerParameterKey: "page" }, { ...serviceInputField, key: "page", inputType: "page" }));
assert.doesNotThrow(() => normalizeMappingDraft({ ...validMapping, providerParameterKey: "video_url" }, { ...serviceInputField, key: "video_url", inputType: "video_url" }));

for (const key of ["action", "service", "quantity", "link"]) {
  assert.throws(() => normalizeMappingDraft({ ...validMapping, providerParameterKey: key }, serviceInputField), /reserved for system-controlled transport fields/i, `Expected ${key} to be rejected`);
}

const baseOrder = {
  orderId: "order_123",
  serviceId: "svc_1",
  provider: "reliablesmm",
  providerServiceId: "7486",
  inputSchemaVersion: 3,
  inputSchemaSnapshot: [
    { key: "username", label: "Username", inputType: "username", required: true, displayOrder: 1, validation: { maxLength: 64 }, schemaVersion: 3, active: true },
    { key: "comments", label: "Comments", inputType: "comments", required: false, displayOrder: 2, validation: { maxLength: 500 }, schemaVersion: 3, active: true },
  ],
  inputValues: { username: "  alice  ", comments: "line one\nline two" },
};

const baseMappings = [
  { service_id: "svc_1", service_input_field_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", provider: "reliablesmm", provider_service_id: "7486", provider_parameter_key: "username", transform_id: "trim", transform_version: 1, provider_required: true, omit_when_blank: false, schema_version: 3, active: true, vanta_input_field_key: "username" },
  { service_id: "svc_1", service_input_field_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", provider: "reliablesmm", provider_service_id: "7486", provider_parameter_key: "comments", transform_id: "normalize_comments", transform_version: 1, provider_required: false, omit_when_blank: true, schema_version: 3, active: true, vanta_input_field_key: "comments" },
];

for (const key of ["action", "service", "quantity", "link"]) {
  assert.throws(() => buildProviderPayload({ ...baseOrder, inputValues: { ...baseOrder.inputValues, [key]: "evil" } }, baseMappings), /provider metadata is rejected|reserved/i, `Expected customer field ${key} injection to be rejected`);
}
assert.throws(() => buildProviderPayload({ ...baseOrder, inputValues: { ...baseOrder.inputValues, providerServiceId: "evil" } }, baseMappings), /provider metadata is rejected|provider.*mismatch/i);
assert.throws(() => buildProviderPayload({ ...baseOrder, inputValues: { ...baseOrder.inputValues, provider: "evil" } }, baseMappings), /provider metadata is rejected|provider.*mismatch/i);

const request = buildReliableSMMProviderRequest({
  providerServiceId: "7486",
  quantity: 100,
  targetValue: "https://example.com/path?x=1",
  payload: {
    service: "9999",
    quantity: 999,
    action: "delete",
    link: "https://evil.example/",
    username: "alice",
    comments: "hello",
  },
});
assert.equal(request.providerServiceId, "7486");
assert.equal(request.quantity, 100);
assert.equal(request.targetValue, "https://example.com/path?x=1");
assert.equal(request.request.service, 7486);
assert.equal(request.request.quantity, 100);
assert.equal(request.request.link, "https://example.com/path?x=1");
assert.equal(request.request.username, "alice");
assert.equal(request.request.comments, "hello");
assert.equal(Object.prototype.hasOwnProperty.call(request.request, "action"), false);
assert.equal(Object.prototype.hasOwnProperty.call(request.request, "provider"), false);

assert.deepEqual([...RELIABLESMM_RESERVED_TRANSPORT_KEYS], ["action", "service", "quantity", "link"]);

console.log("phase38-provider-request-contract-tests: passed");
