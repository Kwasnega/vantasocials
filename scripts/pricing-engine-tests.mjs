import assert from "node:assert/strict";
import { calculatePricing, toPricingString } from "../lib/pricing/engine.ts";

console.log("Starting unified pricing test suite...");

// 1. Basic scaled calculations
const vanta = (quantity) =>
  calculatePricing({
    providerRate: "0.2664",
    providerRateUnit: "PER_1000",
    providerCurrency: "USD",
    fxRate: "10",
    sellingPricePerUnit: "0.01",
    sellingCurrency: "GHS",
    quantity,
  });

assert.equal(
  calculatePricing({
    providerRate: "0",
    providerRateUnit: "PER_UNIT",
    providerCurrency: "USD",
    fxRate: "1",
    sellingPricePerUnit: "0.01",
    sellingCurrency: "GHS",
    quantity: 100,
  }).revenueGhs,
  "1"
);
assert.equal(
  calculatePricing({
    providerRate: "0",
    providerRateUnit: "PER_UNIT",
    providerCurrency: "USD",
    fxRate: "1",
    sellingPricePerUnit: "0.01",
    sellingCurrency: "GHS",
    quantity: 1000,
  }).revenueGhs,
  "10"
);
assert.equal(
  calculatePricing({
    providerRate: "0",
    providerRateUnit: "PER_UNIT",
    providerCurrency: "USD",
    fxRate: "1",
    sellingPricePerUnit: "0.01",
    sellingCurrency: "GHS",
    quantity: 10000,
  }).revenueGhs,
  "100"
);

assert.equal(vanta(100).providerCostUsd, "0.02664");
assert.equal(vanta(1000).providerCostUsd, "0.2664");
assert.equal(vanta(10000).providerCostUsd, "2.664");

// 2. PER_UNIT and PER_ORDER model costs
assert.equal(
  calculatePricing({
    providerRate: "0.5",
    providerRateUnit: "PER_UNIT",
    providerCurrency: "USD",
    fxRate: "10",
    sellingPricePerUnit: "0.01",
    sellingCurrency: "GHS",
    quantity: 100,
  }).providerCostUsd,
  "50"
);
assert.equal(
  calculatePricing({
    providerRate: "0.5",
    providerRateUnit: "PER_ORDER",
    providerCurrency: "USD",
    fxRate: "10",
    sellingPricePerUnit: "0.01",
    sellingCurrency: "GHS",
    quantity: 100,
  }).providerCostUsd,
  "0.5"
);

// 3. Negative validation
assert.throws(() =>
  calculatePricing({
    providerRate: "0.5",
    providerRateUnit: "PER_UNIT",
    providerCurrency: "USD",
    fxRate: "10",
    sellingPricePerUnit: "-1",
    sellingCurrency: "GHS",
    quantity: 100,
  })
);

// 4. Illustrative Example from Section 3 of Spec:
// Provider rate: $0.0423 per 1,000 units.
// FX: 12 GHS per $1 USD.
// Customer price: ₵0.001 per unit (= ₵1.00 per 1,000 units).
// Provider cost: ₵0.5076 per 1,000 units.
// Customer revenue for 10k units: ₵10.00.
// Provider cost for 10k units: ₵5.076.
// Estimated profit for 10k units: ₵4.924.
// Margin: 49.24%.
// Markup: (4.924 / 5.076) * 100 = 97.0055... -> 97.00%
const likes = calculatePricing({
  providerRate: "0.0423",
  providerRateUnit: "PER_1000",
  providerCurrency: "USD",
  fxRate: "12",
  sellingPricePerUnit: "0.001",
  sellingCurrency: "GHS",
  quantity: 10000,
});

assert.equal(likes.providerCostGhsPerBasis, "0.5076");
assert.equal(likes.providerCostGhsPer1000, "0.5076");
assert.equal(likes.sellingPriceGhsPer1000, "1");
assert.equal(likes.grossProfitGhsPer1000, "0.4924");
assert.equal(likes.providerCostGhs, "5.076");
assert.equal(likes.grossProfitGhs, "4.924");
assert.equal(likes.grossMarginPercent, "49.24");
assert.equal(likes.markupPercent, "97");
assert.equal(likes.projection10k?.revenueGhs, "10");
assert.equal(likes.projection10k?.providerCostGhs, "5.076");
assert.equal(likes.projection10k?.profitGhs, "4.924");
assert.equal(likes.lossOrNoMargin, false);

// 5. Zero cost scenario
const freeProvider = calculatePricing({
  providerRate: "0",
  providerRateUnit: "PER_1000",
  providerCurrency: "USD",
  fxRate: "12",
  sellingPricePerUnit: "0.01",
  sellingCurrency: "GHS",
  quantity: 1000,
});
assert.equal(freeProvider.providerCostGhs, "0");
assert.equal(freeProvider.grossProfitGhs, "10");
assert.equal(freeProvider.grossMarginPercent, "100");
assert.equal(freeProvider.markupPercent, null); // Cannot divide by 0 cost
assert.equal(freeProvider.lossOrNoMargin, false);

// 6. Zero revenue scenario
const freeSelling = calculatePricing({
  providerRate: "0.05",
  providerRateUnit: "PER_1000",
  providerCurrency: "USD",
  fxRate: "12",
  sellingPricePerUnit: "0",
  sellingCurrency: "GHS",
  quantity: 1000,
});
assert.equal(freeSelling.revenueGhs, "0");
assert.equal(freeSelling.grossMarginPercent, null); // Cannot divide by 0 revenue
assert.equal(freeSelling.lossOrNoMargin, true);

// 7. Negative profit / loss warning scenario
const lossSelling = calculatePricing({
  providerRate: "0.5",
  providerRateUnit: "PER_1000",
  providerCurrency: "USD",
  fxRate: "12",
  sellingPricePerUnit: "0.001", // ₵1 per 1000, but cost is ₵6 per 1000
  sellingCurrency: "GHS",
  quantity: 1000,
});
assert.equal(lossSelling.providerCostGhs, "6");
assert.equal(lossSelling.revenueGhs, "1");
assert.equal(lossSelling.grossProfitGhs, "-5");
assert.equal(lossSelling.lossOrNoMargin, true);

// 8. PER_ORDER pricing model
const perOrder = calculatePricing({
  providerRate: "0.8",
  providerRateUnit: "PER_ORDER",
  providerCurrency: "USD",
  fxRate: "12",
  sellingPricePerUnit: "15",
  sellingCurrency: "GHS",
  quantity: 1,
});
assert.equal(perOrder.providerCostGhsPerBasis, "9.6");
assert.equal(perOrder.revenueGhs, "15");
assert.equal(perOrder.grossProfitGhs, "5.4");
assert.equal(perOrder.grossMarginPercent, "36");
assert.equal(perOrder.markupPercent, "56.25");
assert.equal(perOrder.projection10k, null); // No 10k projection for per-order
assert.equal(perOrder.grossProfitGhsPer1000, null);

console.log("pricing-engine-tests: ALL TESTS PASSED SUCCESSFULLY");
