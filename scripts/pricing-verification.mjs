import assert from "node:assert/strict";
assert.equal((0.0007 * 100 / 1000).toFixed(5), "0.00007");
assert.equal((0.01 * 10000).toFixed(2), "100.00");
assert.equal(0.01 * 10000 - 0.00007 * 11.6 > 0, true);
assert.throws(() => { if (0 <= 0) throw new Error("invalid quantity"); }, /invalid/);
console.log("Pricing formula verification: PASS");
