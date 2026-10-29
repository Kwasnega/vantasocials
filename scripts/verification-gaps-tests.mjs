import assert from "node:assert/strict";
import fs from "node:fs";

// 1. CACHE WRITE PATHS
const platformPost = fs.readFileSync("app/api/admin/platforms/route.ts", "utf8");
const platformDelete = fs.readFileSync("app/api/admin/platforms/[platformId]/route.ts", "utf8");
const servicePost = fs.readFileSync("app/api/admin/services/route.ts", "utf8");
const serviceDelete = fs.readFileSync("app/api/admin/services/[serviceId]/route.ts", "utf8");
const fieldPost = fs.readFileSync("app/api/admin/services/[serviceId]/input-fields/route.ts", "utf8");
const fieldPatchDelete = fs.readFileSync("app/api/admin/services/[serviceId]/input-fields/[fieldId]/route.ts", "utf8");
const priceSlug = fs.readFileSync("app/api/admin/pricing/[slug]/route.ts", "utf8");
const priceSync = fs.readFileSync("app/api/admin/pricing/sync/route.ts", "utf8");
const mappingPricing = fs.readFileSync("app/api/admin/mappings-and-pricing/route.ts", "utf8");

assert.match(platformPost, /revalidateTag\("catalog"\)/);
assert.match(platformDelete, /revalidateTag\("catalog"\)/);
assert.match(servicePost, /revalidateTag\("catalog"\)/);
assert.match(serviceDelete, /revalidateTag\("catalog"\)/);
assert.match(fieldPost, /revalidateTag\("catalog"\)/);
assert.match(fieldPatchDelete, /revalidateTag\("catalog"\)/);
assert.match(priceSlug, /revalidateTag\("catalog"\)/);
assert.match(priceSync, /revalidateTag\("catalog"\)/);
assert.match(mappingPricing, /revalidateTag\("catalog"\)/);

// 2. PRICE FRESHNESS (Money paths do not use cached fetchers)
const ordersRoute = fs.readFileSync("app/api/orders/route.ts", "utf8");
const checkoutLib = fs.readFileSync("lib/orders/checkout.ts", "utf8");
const paymentsInit = fs.readFileSync("app/api/payments/initialize/route.ts", "utf8");
const paymentsWallet = fs.readFileSync("app/api/payments/wallet/route.ts", "utf8");

assert.doesNotMatch(ordersRoute, /getServices|getService|getCustomerService/);
assert.doesNotMatch(checkoutLib, /getServices|getService|getCustomerService/);
assert.doesNotMatch(paymentsInit, /getServices|getService|getCustomerService/);
assert.doesNotMatch(paymentsWallet, /getServices|getService|getCustomerService/);
assert.match(ordersRoute, /admin[\s\S]*?\.from\("services"\)[\s\S]*?\.select/);
assert.match(checkoutLib, /admin[\s\S]*?\.from\("orders"\)[\s\S]*?\.select/);

// 3. POSTHOG LAZY LOADING
const instrumentation = fs.readFileSync("instrumentation-client.ts", "utf8");
const logoutBtn = fs.readFileSync("components/auth/LogoutButton.tsx", "utf8");

assert.doesNotMatch(instrumentation, /^import posthog from "posthog-js"/m);
assert.match(instrumentation, /import\("posthog-js"\)/);
assert.doesNotMatch(logoutBtn, /^import posthog from "posthog-js"/m);
assert.match(logoutBtn, /import\("posthog-js"\)/);

// 4. RATE LIMIT CLEANUP IN CRON & FAIL CLOSED
const cronRoute = fs.readFileSync("app/api/internal/fulfillment/cron/route.ts", "utf8");
assert.match(cronRoute, /cleanup_rate_limit_buckets/);

// Fail closed check: orders, wallet deposit, payments call limiterUnavailable()
assert.match(ordersRoute, /consumeRateLimits[\s\S]*?catch\s*\{\s*return limiterUnavailable\(\);/);
const depositRoute = fs.readFileSync("app/api/account/wallet/deposit/route.ts", "utf8");
assert.match(depositRoute, /consumeRateLimits[\s\S]*?catch\s*\{\s*return limiterUnavailable\(\);/);
assert.match(paymentsInit, /consumeRateLimits[\s\S]*?catch\s*\{\s*return limiterUnavailable\(\);/);

console.log("verification-gaps-tests: passed");
