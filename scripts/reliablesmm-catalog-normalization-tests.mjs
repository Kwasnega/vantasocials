import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("lib/fulfillment/reliablesmm/catalog.ts", "utf8");
assert.match(source, /unit === "per_1000" \? "per_1000"/);
assert.match(source, /unit === "per_order" \? "per_order"/);
assert.match(source, /: "unknown"/);
console.log("reliablesmm-catalog-normalization-tests: passed");
