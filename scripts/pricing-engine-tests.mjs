import assert from "node:assert/strict";
import { calculatePricing, toPricingString } from "../lib/pricing/engine.ts";

const vanta = (quantity) => calculatePricing({ providerRate: "0.2664", providerRateUnit: "PER_1000", providerCurrency: "USD", fxRate: "10", sellingPricePerUnit: "0.01", sellingCurrency: "GHS", quantity });
assert.equal(calculatePricing({ providerRate: "0", providerRateUnit: "PER_UNIT", providerCurrency: "USD", fxRate: "1", sellingPricePerUnit: "0.01", sellingCurrency: "GHS", quantity: 100 }).revenueGhs, "1");
assert.equal(calculatePricing({ providerRate: "0", providerRateUnit: "PER_UNIT", providerCurrency: "USD", fxRate: "1", sellingPricePerUnit: "0.01", sellingCurrency: "GHS", quantity: 1000 }).revenueGhs, "10");
assert.equal(calculatePricing({ providerRate: "0", providerRateUnit: "PER_UNIT", providerCurrency: "USD", fxRate: "1", sellingPricePerUnit: "0.01", sellingCurrency: "GHS", quantity: 10000 }).revenueGhs, "100");
assert.equal(vanta(100).providerCostUsd, "0.02664");
assert.equal(vanta(1000).providerCostUsd, "0.2664");
assert.equal(vanta(10000).providerCostUsd, "2.664");
assert.equal(calculatePricing({ providerRate: "0.5", providerRateUnit: "PER_UNIT", providerCurrency: "USD", fxRate: "10", sellingPricePerUnit: "0.01", sellingCurrency: "GHS", quantity: 100 }).providerCostUsd, "50");
assert.equal(calculatePricing({ providerRate: "0.5", providerRateUnit: "PER_ORDER", providerCurrency: "USD", fxRate: "10", sellingPricePerUnit: "0.01", sellingCurrency: "GHS", quantity: 100 }).providerCostUsd, "0.5");
assert.throws(() => calculatePricing({ providerRate: "0.5", providerRateUnit: "PER_UNIT", providerCurrency: "USD", fxRate: "10", sellingPricePerUnit: "-1", sellingCurrency: "GHS", quantity: 100 }));
assert.equal(vanta(10000).previewQuantity, 10000);
assert.equal(calculatePricing({ providerRate: toPricingString(0.0901), providerRateUnit: "PER_1000", providerCurrency: "USD", fxRate: toPricingString(11), sellingPricePerUnit: toPricingString(0.01), sellingCurrency: "GHS", quantity: 10000 }).providerCostGhsPerUnit, "0.000991");
console.log("pricing-engine-tests: passed");
