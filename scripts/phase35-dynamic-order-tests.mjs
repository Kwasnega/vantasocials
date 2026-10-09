import assert from "node:assert/strict";
import { sanitizeCustomerInputField } from "../lib/customer/service-contract.ts";
import { buildDynamicSchemaSnapshot, validateDynamicFieldValues } from "../lib/orders/dynamic-input-validation.ts";

const usernameField = {
  key: "username",
  label: "Username",
  input_type: "username",
  required: true,
  display_order: 1,
  placeholder: "@example",
  help_text: "Your exact username.",
  validation_config: { maxLength: 64 },
  schema_version: 3,
  active: true,
};

const commentsField = {
  key: "comments",
  label: "Comments",
  input_type: "comments",
  required: false,
  display_order: 2,
  placeholder: "Add a custom comment line",
  help_text: "One item per line.",
  validation_config: { maxLength: 500, maxLines: 5, maxLineLength: 80 },
  schema_version: 3,
  active: true,
};

const urlField = {
  key: "post_url",
  label: "Post URL",
  input_type: "post_url",
  required: true,
  display_order: 1,
  placeholder: "https://example.com/post",
  help_text: "The exact URL to boost.",
  validation_config: { maxLength: 2048 },
  schema_version: 2,
  active: true,
};

const build = buildDynamicSchemaSnapshot([usernameField, commentsField]);
assert.equal(build.schemaVersion, 3);
assert.deepEqual(build.schemaSnapshot.map((field) => field.key), ["username", "comments"]);
assert.deepEqual(validateDynamicFieldValues(build.schemaSnapshot, { username: "alice", comments: "line one\nline two" }).validatedValues, {
  username: "alice",
  comments: { lines: ["line one", "line two"] },
});

assert.throws(() => validateDynamicFieldValues(build.schemaSnapshot, { username: "alice", extra: "nope" }), /Unknown dynamic field key/);
assert.throws(() => validateDynamicFieldValues(build.schemaSnapshot, { username: "", comments: "ok" }), /required/i);
assert.throws(() => validateDynamicFieldValues(build.schemaSnapshot, { username: 12, comments: "ok" }), /must be text/i);
assert.throws(() => validateDynamicFieldValues(build.schemaSnapshot, { username: "alice", comments: "line one\nline two\nline three\nline four\nline five\nline six" }), /exceed|must be/i);
assert.throws(() => buildDynamicSchemaSnapshot([{ ...usernameField, input_type: "unsupported", active: true }]), /unsupported or invalid/i);
assert.throws(() => sanitizeCustomerInputField({ ...usernameField, active: false }), /Inactive fields are not exposed to customers/i);
assert.throws(() => buildDynamicSchemaSnapshot([{ ...usernameField, provider_parameter_key: "username" }]), /unsupported or invalid/i);

const serviceB = buildDynamicSchemaSnapshot([urlField]);
assert.throws(() => validateDynamicFieldValues(serviceB.schemaSnapshot, { username: "alice" }), /Unknown dynamic field key/);

const longComments = {
  key: "comments",
  label: "Comments",
  input_type: "comments",
  required: false,
  display_order: 0,
  validation_config: { maxLength: 50, maxLines: 2, maxLineLength: 10 },
  schema_version: 1,
  active: true,
};
assert.throws(() => validateDynamicFieldValues(buildDynamicSchemaSnapshot([longComments]).schemaSnapshot, { comments: "line one\nline two\nline three" }), /exceed|must be/i);
assert.throws(() => validateDynamicFieldValues(buildDynamicSchemaSnapshot([longComments]).schemaSnapshot, { comments: "line 1234567890" }), /exceed|must be/i);
assert.throws(() => validateDynamicFieldValues(buildDynamicSchemaSnapshot([longComments]).schemaSnapshot, { comments: { lines: ["a"] } }), /must be text/i);
assert.throws(() => validateDynamicFieldValues(buildDynamicSchemaSnapshot([longComments]).schemaSnapshot, { schema_version: 42 }), /Unknown dynamic field key/);

console.log("phase35-dynamic-order-tests: passed");
