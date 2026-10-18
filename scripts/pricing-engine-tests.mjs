import assert from "node:assert/strict";
import { calculatePricing, formatGhsAmount, normalizePricingValue, normalizeProviderPricingValue, toPricingString } from "../lib/pricing/engine.ts";

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

const perThousand = calculatePricing({
  providerRate: "0.5",
  providerRateUnit: "PER_1000",
  providerCurrency: "USD",
  fxRate: "12",
  sellingPricePerUnit: "0.005",
  sellingCurrency: "GHS",
  quantity: 2000,
});
assert.equal(perThousand.revenueGhs, "10");
assert.equal(perThousand.providerCostUsd, "1");
assert.equal(perThousand.providerCostGhs, "12");
assert.equal(perThousand.grossProfitGhs, "-2");
assert.equal(perThousand.grossMarginPercent, "-20");
assert.equal(perThousand.markupPercent, "-16.67");

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
assert.equal(likes.markupPercent, "97.01");
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
  sellingPricePerUnit: "0.005",
  sellingCurrency: "GHS",
  quantity: 2000,
});
assert.equal(perOrder.providerCostGhsPerBasis, "9.6");
assert.equal(perOrder.revenueGhs, "10");
assert.equal(perOrder.grossProfitGhs, "0.4");
assert.equal(perOrder.grossMarginPercent, "4");
assert.equal(perOrder.markupPercent, "4.17");
assert.equal(perOrder.projection10k?.revenueGhs, "50");
assert.equal(perOrder.projection10k?.providerCostGhs, "9.6");
assert.equal(perOrder.projection10k?.profitGhs, "40.4");
assert.equal(perOrder.grossProfitGhsPer1000, null);

// Required comparison: same customer rate, different provider billing units.
const providerExample = (providerRateUnit, quantity) =>
  calculatePricing({
    providerRate: "2.50",
    providerRateUnit,
    providerCurrency: "USD",
    fxRate: "12.00",
    sellingPricePerUnit: "0.005",
    sellingCurrency: "GHS",
    quantity,
  });
const per1000At1000 = providerExample("PER_1000", 1000);
const per1000At2000 = providerExample("PER_1000", 2000);
assert.equal(per1000At1000.revenueGhs, "5");
assert.equal(per1000At1000.providerCostGhs, "30");
assert.equal(per1000At1000.grossProfitGhs, "-25");
assert.equal(per1000At1000.grossMarginPercent, "-500");
assert.equal(per1000At1000.markupPercent, "-83.33");
assert.equal(per1000At2000.revenueGhs, "10");
assert.equal(per1000At2000.providerCostGhs, "60");
assert.equal(per1000At2000.grossProfitGhs, "-50");
assert.equal(per1000At2000.grossMarginPercent, "-500");
assert.equal(per1000At2000.markupPercent, "-83.33");

const perOrderAt1000 = providerExample("PER_ORDER", 1000);
const perOrderAt2000 = providerExample("PER_ORDER", 2000);
assert.equal(perOrderAt1000.revenueGhs, "5");
assert.equal(perOrderAt1000.providerCostGhs, "30");
assert.equal(perOrderAt1000.grossProfitGhs, "-25");
assert.equal(perOrderAt1000.grossMarginPercent, "-500");
assert.equal(perOrderAt1000.markupPercent, "-83.33");
assert.equal(perOrderAt2000.revenueGhs, "10");
assert.equal(perOrderAt2000.providerCostGhs, "30");
assert.equal(perOrderAt2000.grossProfitGhs, "-20");
assert.equal(perOrderAt2000.grossMarginPercent, "-200");
assert.equal(perOrderAt2000.markupPercent, "-66.67");

const breakEven = calculatePricing({
  providerRate: "0.5",
  providerRateUnit: "PER_1000",
  providerCurrency: "USD",
  fxRate: "10",
  sellingPricePerUnit: "0.005",
  sellingCurrency: "GHS",
  quantity: 1000,
});
assert.equal(breakEven.grossProfitGhs, "0");
assert.equal(breakEven.profitability, "BREAK_EVEN");
assert.equal(breakEven.lossOrNoMargin, false);

const tinyRate = calculatePricing({
  providerRate: "0.0000009",
  providerRateUnit: "PER_1000",
  providerCurrency: "USD",
  fxRate: "12.123456789012",
  sellingPricePerUnit: "0.005",
  sellingCurrency: "GHS",
  quantity: 1000,
});
assert.equal(tinyRate.providerCostUsd, "0.0000009");
assert.equal(tinyRate.providerCostGhs, "0.000010911111");
assert.equal(tinyRate.grossProfitGhs, "4.999989088889");
assert.equal(normalizeProviderPricingValue("0.0000009"), "0.0000009");
assert.equal(normalizePricingValue(12.123456789012), "12.123456789012");
assert.equal(normalizePricingValue(0.2664), "0.2664");
assert.equal(normalizePricingValue(1e-7), "0.0000001");
assert.equal(formatGhsAmount(tinyRate.providerCostGhs), "0.00");
assert.equal(formatGhsAmount("-25"), "-25.00");
assert.throws(() => normalizeProviderPricingValue("1.1234567890123"), /precision/);
assert.throws(() => normalizeProviderPricingValue("1000000000000"), /storage range/);
assert.throws(() => normalizePricingValue(0.12345678901234), /represented exactly/);

console.log("pricing-engine-tests: ALL TESTS PASSED SUCCESSFULLY");
