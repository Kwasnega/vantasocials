import assert from "node:assert/strict";
import { evaluateServiceSpike, windowKeyToHours } from "../lib/admin/failures/types.ts";

async function runFailuresTests() {
  console.log("=== RUNNING ADMIN FAILURES ANALYTICS UNIT TESTS ===");

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${name}:`, err.message);
    }
  }

  // 1. Window key parsing
  console.log("\n--- 1. Window Mapping ---");
  await test("windowKeyToHours maps 24h, 7d, 30d correctly", () => {
    assert.equal(windowKeyToHours("24h"), 24);
    assert.equal(windowKeyToHours("7d"), 168);
    assert.equal(windowKeyToHours("30d"), 720);
    assert.equal(windowKeyToHours("unknown"), 168); // fallback
  });

  // 2. Spike detection rules
  console.log("\n--- 2. Spike Detection Algorithm ---");
  await test("Flags spike when 24h failure rate > 2x 7d rate, >15%, and orders >= 10", () => {
    // 24h: 20 orders, 6 failed = 30%
    // 7d: 100 orders, 10 failed = 10%
    // 30% is > 2 * 10% (20%) and > 15%, orders 20 >= 10 -> Spike!
    const res = evaluateServiceSpike({
      orders24h: 20,
      failed24h: 6,
      orders7d: 100,
      failed7d: 10,
    });
    assert.equal(res.isSpike, true);
    assert.equal(res.rate24h, 30);
    assert.equal(res.rate7d, 10);
  });

  await test("Rejects spike if 24h orders < 10 (minimum volume rule)", () => {
    // 24h: 5 orders, 3 failed = 60%
    // orders 5 < 10 -> not a valid spike
    const res = evaluateServiceSpike({
      orders24h: 5,
      failed24h: 3,
      orders7d: 50,
      failed7d: 5,
    });
    assert.equal(res.isSpike, false);
  });

  await test("Rejects spike if 24h failure rate <= 15%", () => {
    // 24h: 20 orders, 2 failed = 10%
    // 7d: 100 orders, 2 failed = 2%
    // 10% is > 2x 2%, but <= 15% threshold -> not a spike
    const res = evaluateServiceSpike({
      orders24h: 20,
      failed24h: 2,
      orders7d: 100,
      failed7d: 2,
    });
    assert.equal(res.isSpike, false);
  });

  await test("Rejects spike if 24h rate is not > 2x 7d rate", () => {
    // 24h: 20 orders, 5 failed = 25%
    // 7d: 100 orders, 20 failed = 20%
    // 25% is not > 2x 20% (40%) -> not an acute spike
    const res = evaluateServiceSpike({
      orders24h: 20,
      failed24h: 5,
      orders7d: 100,
      failed7d: 20,
    });
    assert.equal(res.isSpike, false);
  });

  await test("Handles zero-division safely when 7d failed orders is 0", () => {
    // 24h: 20 orders, 4 failed = 20%
    // 7d: 20 orders, 0 failed = 0%
    // Rate 20% > 15%, orders >= 10, prior failures 0 -> Spike!
    const res = evaluateServiceSpike({
      orders24h: 20,
      failed24h: 4,
      orders7d: 20,
      failed7d: 0,
    });
    assert.equal(res.isSpike, true);
  });

  // 3. Minimum volume filtering on display list
  console.log("\n--- 3. Aggregation & Filter Edge Cases ---");
  await test("Minimum volume filter isolates services with >= 10 orders", () => {
    const mockServices = [
      { id: "1", name: "High Volume", total_orders: 50, failed_orders: 5 },
      { id: "2", name: "Low Volume Noise", total_orders: 3, failed_orders: 3 },
      { id: "3", name: "Threshold Service", total_orders: 10, failed_orders: 2 },
    ];
    const filtered = mockServices.filter((s) => s.total_orders >= 10);
    assert.equal(filtered.length, 2);
    assert.equal(filtered[0].id, "1");
    assert.equal(filtered[1].id, "3");
  });

  console.log(`\n=== FAILURES ANALYTICS TEST SUMMARY: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runFailuresTests();
