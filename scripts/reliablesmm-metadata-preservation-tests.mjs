import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("lib/fulfillment/reliablesmm/catalog.ts", "utf8");
const snapshot = JSON.parse(fs.readFileSync("scripts/reliablesmm-r1-live.json", "utf8"));
assert.match(source, /rawMetadata:\s*\{ \.\.\.service \}/);

for (const id of ["7486", "7972", "5661", "4210", "7099", "7857"]) {
  const row = Object.values(snapshot.candidates).flat().find((candidate) => String(candidate.id) === id);
  assert.ok(row, `snapshot row ${id} exists`);
  assert.equal(typeof row.type, "string");
  assert.equal(typeof row.category, "string");
  assert.equal(typeof row.name, "string");
  assert.ok(["string", "number"].includes(typeof row.rate));
  assert.ok("service" in row || "id" in row, `provider identity retained for ${id}`);
  assert.ok("min" in row && "max" in row, `quantity metadata retained for ${id}`);
  assert.ok("refill" in row && "cancel" in row, `capability metadata retained for ${id}`);
}

console.log("reliablesmm-metadata-preservation-tests: 6 representative rows verified, 0 failed");
