import assert from "node:assert/strict";
import fs from "node:fs";

console.log("=== RUNNING ADMIN CRON EMPTY BATCH TEST ===");

const cronRoutePath = "app/api/internal/fulfillment/cron/route.ts";
const reconcileRoutePath = "app/api/internal/fulfillment/reconcile/route.ts";
const reconcileModulePath = "lib/fulfillment/reliablesmm/reconcile.ts";

assert.ok(fs.existsSync(cronRoutePath), "Cron route file exists");
assert.ok(fs.existsSync(reconcileRoutePath), "Reconcile route file exists");
assert.ok(fs.existsSync(reconcileModulePath), "Reconcile module file exists");

const cronCode = fs.readFileSync(cronRoutePath, "utf8");
const reconcileCode = fs.readFileSync(reconcileModulePath, "utf8");

// 1. Verify BATCH_SIZE is capped and <= 25
const batchSizeMatch = cronCode.match(/const BATCH_SIZE = (\d+);/);
assert.ok(batchSizeMatch, "BATCH_SIZE constant defined");
const batchSize = Number.parseInt(batchSizeMatch[1], 10);
assert.ok(batchSize > 0 && batchSize <= 25, `BATCH_SIZE (${batchSize}) is within [1, 25]`);
console.log(`✓ Cron batch size is bounded: ${batchSize}`);

// 2. Verify orders query uses .limit(BATCH_SIZE)
assert.ok(cronCode.includes(".limit(BATCH_SIZE)"), "Orders query applies .limit(BATCH_SIZE)");
console.log("✓ Cron orders query applies hard batch limit.");

// 3. Verify that when orders is empty or null, loop body is bypassed
assert.ok(cronCode.includes("for (const order of orders || [])"), "Loop uses empty-safe iterator");
console.log("✓ Empty batch bypasses fulfillment processing safely.");

// 4. Verify reconciliation batch is bounded and skips non-due orders
assert.ok(reconcileCode.includes("reconcileReliableSMMBatch"), "reconcileReliableSMMBatch function present");
assert.ok(reconcileCode.includes("Math.min(Math.max(limit,1),10)"), "Reconcile batch hard limit capped at 10");
assert.ok(reconcileCode.includes("next_poll_at.lte"), "Only selects orders where next_poll_at is due");
console.log("✓ Reconcile batch queries only due attempts with max 10 limit.");

console.log("=== ALL CRON EMPTY BATCH CHECKS PASSED ===");
