import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("app/admin/services/[serviceId]/inputs/ServiceInputConfiguration.tsx", "utf8");
const start = source.indexOf("const validationDefaults =");
const end = source.indexOf("/* ─── Design tokens", start);
assert.notEqual(start, -1, "validation suggestions are defined");
assert.notEqual(end, -1, "suggestion helper ends before component styles");

const helperSource = source.slice(start, end);
const compiled = ts.transpileModule(`${helperSource}\nexport { validationDefaults, validationSuggestions, getFieldSuggestions };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports });
const { validationDefaults, validationSuggestions, getFieldSuggestions } = module.exports;

for (const [type, suggestions] of Object.entries(validationSuggestions)) {
  const defaults = validationDefaults[type];
  for (const [key, values] of Object.entries(suggestions)) {
    assert.ok(values.every((value) => Number.isSafeInteger(value) && value > 0 && value <= defaults[key]));
    assert.ok(values.includes(defaults[key]), `${type}.${key} suggestions preserve the validator's maximum`);
  }
}

assert.deepEqual(
  JSON.parse(JSON.stringify(getFieldSuggestions("post_url", "instagram").placeholders)),
  ["https://www.instagram.com/p/POST_ID/"],
);
assert.deepEqual(
  JSON.parse(JSON.stringify(getFieldSuggestions("video_url", "youtube").placeholders)),
  ["https://www.youtube.com/watch?v=VIDEO_ID"],
);
assert.deepEqual(
  JSON.parse(JSON.stringify(getFieldSuggestions("video_url", "tiktok").placeholders)),
  ["https://www.tiktok.com/@username/video/VIDEO_ID"],
);
assert.deepEqual(
  JSON.parse(JSON.stringify(getFieldSuggestions("comments", "instagram").keys)),
  ["comments"],
);

console.log("Service input suggestion tests passed.");
