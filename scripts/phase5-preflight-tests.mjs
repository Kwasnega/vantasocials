import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/internal/fulfillment/preflight/route.ts", "utf8");
assert.match(route, /CRON_SECRET/);
assert.match(route, /status:\s*401/);
assert.match(route, /provider_orders/);
assert.match(route, /provider_operation_locks/);
assert.match(route, /instagram-views/);
assert.match(route, /7486/);
assert.match(route, /instagram-followers/);
assert.doesNotMatch(route, /fetch\s*\(/);
assert.doesNotMatch(route, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
console.log("phase5-preflight-tests: passed");
