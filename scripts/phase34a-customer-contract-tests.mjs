import assert from "node:assert/strict";
import { sanitizeCustomerInputField, sanitizeCustomerInputFields, getFieldControlType, validateCustomerInputValue } from "../lib/customer/service-contract.ts";

const validField = {
  key: "target_url",
  label: "Target URL",
  inputType: "url",
  required: true,
  displayOrder: 2,
  placeholder: "https://example.com",
  helpText: "Paste the exact link.",
  validation: { rule: "url", config: { maxLength: 2048 } },
  schemaVersion: 1,
  active: true,
};

const sanitized = sanitizeCustomerInputField(validField);
assert.deepEqual(sanitized, {
  key: "target_url",
  label: "Target URL",
  inputType: "url",
  required: true,
  displayOrder: 2,
  placeholder: "https://example.com",
  helpText: "Paste the exact link.",
  validation: { maxLength: 2048 },
});

assert.throws(() => sanitizeCustomerInputField({ ...validField, inputType: "unknown" }));
assert.throws(() => sanitizeCustomerInputField({ ...validField, active: false }));
assert.throws(() => sanitizeCustomerInputField({ ...validField, key: "TargetURL" }));
assert.throws(() => sanitizeCustomerInputField({ ...validField, provider_parameter_key: "link" }));
assert.deepEqual(
  sanitizeCustomerInputFields([
    { ...validField, key: "z_last", displayOrder: 10, active: true },
    { ...validField, key: "a_first", displayOrder: 1, active: true },
    { ...validField, key: "hidden", displayOrder: 0, active: false },
    { ...validField, key: "bad", inputType: "unknown", displayOrder: 3, active: true },
  ]).map((field) => field.key),
  ["a_first", "z_last"],
);

assert.equal(getFieldControlType("username"), "text");
assert.equal(getFieldControlType("url"), "url");
assert.equal(getFieldControlType("post_url"), "url");
assert.equal(getFieldControlType("video_url"), "url");
assert.equal(getFieldControlType("channel"), "text");
assert.equal(getFieldControlType("page"), "text");
assert.equal(getFieldControlType("comments"), "textarea");

const requiredUrl = sanitizeCustomerInputField({ ...validField, key: "target", label: "Target", inputType: "url", required: true, displayOrder: 0, validation: { rule: "url", config: { maxLength: 2048 } } });
assert.equal(validateCustomerInputValue(requiredUrl, "").error, "This field is required.");
assert.equal(validateCustomerInputValue(requiredUrl, "https://example.com").error, "");
assert.equal(validateCustomerInputValue(sanitizeCustomerInputField({ ...validField, key: "comments", label: "Comments", inputType: "comments", required: false, displayOrder: 1, validation: { rule: "comments", config: { maxLength: 1000, maxLines: 10, maxLineLength: 200 } } }), "hello\nworld").error, "");
assert.equal(validateCustomerInputValue(sanitizeCustomerInputField({ ...validField, key: "comments", label: "Comments", inputType: "comments", required: true, displayOrder: 1, validation: { rule: "comments", config: { maxLength: 1000, maxLines: 10, maxLineLength: 200 } } }), "\n\n").error, "This field is required.");
assert.match(validateCustomerInputValue(sanitizeCustomerInputField({ ...validField, key: "comments", label: "Comments", inputType: "comments", required: false, displayOrder: 1, validation: { rule: "comments", config: { maxLength: 10, maxLines: 2, maxLineLength: 5 } } }), "line 1\nline 2\nline 3").error, /must be|too long|exceeds|limit/i);

console.log("phase34a-customer-contract-tests: passed");
