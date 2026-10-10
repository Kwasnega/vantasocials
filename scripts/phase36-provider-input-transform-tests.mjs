import assert from "node:assert/strict";
import { buildProviderPayload, buildProviderPayloadForOrder } from "../lib/fulfillment/provider-input-transform.ts";

const serviceId = "11111111-1111-1111-1111-111111111111";
const providerServiceId = "7486";
const provider = "reliablesmm";

const baseOrder = {
  orderId: "order_123",
  serviceId,
  provider,
  providerServiceId,
  inputSchemaVersion: 3,
  inputSchemaSnapshot: [
    { key: "username", label: "Username", inputType: "username", required: true, displayOrder: 1, validation: { maxLength: 64 }, schemaVersion: 3, active: true },
    { key: "url", label: "URL", inputType: "url", required: true, displayOrder: 2, validation: { maxLength: 2048 }, schemaVersion: 3, active: true },
    { key: "comments", label: "Comments", inputType: "comments", required: false, displayOrder: 3, validation: { maxLength: 500, maxLines: 5, maxLineLength: 80 }, schemaVersion: 3, active: true },
    { key: "channel", label: "Channel", inputType: "channel", required: false, displayOrder: 4, validation: { maxLength: 255 }, schemaVersion: 3, active: true },
    { key: "page", label: "Page", inputType: "page", required: false, displayOrder: 5, validation: { maxLength: 255 }, schemaVersion: 3, active: true },
  ],
  inputValues: {
    username: "  alice  ",
    url: "https://example.com/path?x=1#fragment",
    comments: "line one\nline two",
    channel: "  mychannel  ",
    page: " page-01 ",
  },
};

const baseMappings = [
  { service_id: serviceId, service_input_field_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", provider, provider_service_id: providerServiceId, provider_parameter_key: "username", transform_id: "trim", transform_version: 1, provider_required: true, omit_when_blank: false, schema_version: 3, active: true, vanta_input_field_key: "username" },
  { service_id: serviceId, service_input_field_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", provider, provider_service_id: providerServiceId, provider_parameter_key: "link", transform_id: "normalize_url", transform_version: 1, provider_required: true, omit_when_blank: false, schema_version: 3, active: true, vanta_input_field_key: "url" },
  { service_id: serviceId, service_input_field_id: "cccccccc-cccc-cccc-cccc-cccccccccccc", provider, provider_service_id: providerServiceId, provider_parameter_key: "comments", transform_id: "normalize_comments", transform_version: 1, provider_required: false, omit_when_blank: true, schema_version: 3, active: true, vanta_input_field_key: "comments" },
  { service_id: serviceId, service_input_field_id: "dddddddd-dddd-dddd-dddd-dddddddddddd", provider, provider_service_id: providerServiceId, provider_parameter_key: "channel_name", transform_id: "trim", transform_version: 1, provider_required: false, omit_when_blank: false, schema_version: 3, active: true, vanta_input_field_key: "channel" },
  { service_id: serviceId, service_input_field_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", provider, provider_service_id: providerServiceId, provider_parameter_key: "page_name", transform_id: "trim", transform_version: 1, provider_required: false, omit_when_blank: false, schema_version: 3, active: true, vanta_input_field_key: "page" },
];

const result = buildProviderPayload(baseOrder, baseMappings);
assert.equal(result.provider, "reliablesmm");
assert.equal(result.providerServiceId, "7486");
assert.equal(result.payload.service, "7486");
assert.equal(result.payload.username, "alice");
assert.equal(result.payload.link, "https://example.com/path?x=1");
assert.deepEqual(result.payload.comments, { lines: ["line one", "line two"] });
assert.equal(result.payload.channel_name, "mychannel");
assert.equal(result.payload.page_name, "page-01");

const blankOptionalOrder = {
  ...baseOrder,
  inputValues: { ...baseOrder.inputValues, comments: "   " },
};
const blankOptionalResult = buildProviderPayload(blankOptionalOrder, [
  ...baseMappings.filter((mapping) => mapping.vanta_input_field_key !== "comments"),
  { ...baseMappings.find((mapping) => mapping.vanta_input_field_key === "comments"), provider_parameter_key: "comments", omit_when_blank: true },
]);
assert.equal(Object.prototype.hasOwnProperty.call(blankOptionalResult.payload, "comments"), false);

const commentsFalse = buildProviderPayload({
  ...baseOrder,
  inputValues: { ...baseOrder.inputValues, comments: "   " },
}, [
  ...baseMappings.filter((mapping) => mapping.vanta_input_field_key !== "comments"),
  { ...baseMappings.find((mapping) => mapping.vanta_input_field_key === "comments"), omit_when_blank: false },
]);
assert.deepEqual(commentsFalse.payload.comments, { lines: [] });

assert.throws(() => buildProviderPayload({ ...baseOrder, inputValues: { ...baseOrder.inputValues, unsupported: "nope" } }, baseMappings), /Unknown VANTA field/i);
assert.throws(() => buildProviderPayload({ ...baseOrder, inputValues: { ...baseOrder.inputValues, username: "   " } }, [{ ...baseMappings[0], provider_required: true, provider_parameter_key: "username" }]), /required/i);
assert.throws(() => buildProviderPayload(baseOrder, [{ ...baseMappings[0], provider_parameter_key: "username", active: false }]), /inactive/i);
assert.throws(() => buildProviderPayload(baseOrder, [{ ...baseMappings[0], provider: "otherprovider" }]), /provider.*mismatch|provider.*does not match/i);
assert.throws(() => buildProviderPayload(baseOrder, [{ ...baseMappings[0], transform_id: "unknown_transform", transform_version: 1 }]), /unknown or unsupported|unknown transform/i);
assert.throws(() => buildProviderPayload(baseOrder, [{ ...baseMappings[0], transform_id: "trim", transform_version: 99 }]), /unsupported.*version|unknown or unsupported/i);
assert.throws(() => buildProviderPayload({ ...baseOrder, inputSchemaSnapshot: [] }, baseMappings), /missing.*snapshot|schema snapshot/i);
assert.throws(() => buildProviderPayload({ ...baseOrder, provider: "evild", providerServiceId: "9999" }, baseMappings), /provider.*mismatch|provider.*does not match/i);
assert.throws(() => buildProviderPayload({ ...baseOrder, inputValues: { ...baseOrder.inputValues, provider: "evil" } }, baseMappings), /customer.*provider|provider.*metadata/i);
assert.throws(() => buildProviderPayload(baseOrder, [
  ...baseMappings,
  { ...baseMappings[0], service_input_field_id: "ffffffff-ffff-ffff-ffff-ffffffffffff" },
]), /duplicate|conflicting/i);

const historicalOrder = {
  ...baseOrder,
  inputValues: { username: "historical-user" },
  inputSchemaSnapshot: [
    { key: "username", label: "Username", inputType: "username", required: true, displayOrder: 1, validation: { maxLength: 64 }, schemaVersion: 3, active: true },
  ],
};
const historical = buildProviderPayload(historicalOrder, [
  { service_id: serviceId, service_input_field_id: "d7d7d7d7-d7d7-d7d7-d7d7-d7d7d7d7d7d7", provider, provider_service_id: providerServiceId, provider_parameter_key: "username", transform_id: "trim", transform_version: 1, provider_required: true, omit_when_blank: false, schema_version: 3, active: true, vanta_input_field_key: "username" },
]);
assert.equal(historical.payload.username, "historical-user");

const wrapper = buildProviderPayloadForOrder(baseOrder, baseMappings);
assert.deepEqual(wrapper.payload, result.payload);
assert.equal(wrapper.provider, result.provider);
assert.equal(wrapper.providerServiceId, result.providerServiceId);

console.log("phase36-provider-input-transform-tests: passed");
