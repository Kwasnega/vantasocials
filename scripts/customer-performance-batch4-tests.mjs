import assert from "node:assert/strict";
import fs from "node:fs";

const authServer = fs.readFileSync("lib/supabase/server.ts", "utf8");
const requireUser = fs.readFileSync("lib/auth/require-user.ts", "utf8");
const middleware = fs.readFileSync("middleware.ts", "utf8");
const dashboard = fs.readFileSync("components/dashboard/AuthenticatedDashboardLayout.tsx", "utf8");
const checkout = fs.readFileSync("lib/orders/checkout.ts", "utf8");
const service = fs.readFileSync("lib/customer/service-contract-server.ts", "utf8");
const orderHistory = fs.readFileSync("app/account/orders/page.tsx", "utf8");
const walletPage = fs.readFileSync("app/account/wallet/page.tsx", "utf8");

assert.match(authServer, /export const getCurrentUser = cache\(async \(\) =>/);
assert.match(requireUser, /const user = await getCurrentUser\(\)/);
assert.match(requireUser, /if \(!user\) redirect/);
assert.match(middleware, /await supabase\.auth\.getUser\(\)/);
assert.match(
  dashboard,
  /<Suspense fallback=\{<DashboardLoading variant=\{loadingVariant\} \/>\}>/,
  "dashboard shell can stream its skeleton while server auth resolves",
);
assert.match(dashboard, /const \{ user \} = await requireUser\(nextPath\)/);
assert.match(dashboard, /<AccountSidebar email=\{user\.email \?\? ""\} \/>/);
assert.match(dashboard, /<section className="dashboard-content">\{children\}<\/section>/);

const walletStart = checkout.indexOf("const walletPromise =");
const orderAwait = checkout.indexOf("= await admin", walletStart);
assert.ok(walletStart >= 0 && orderAwait > walletStart, "checkout starts the independent wallet read before awaiting the order read");
assert.match(checkout, /services\(name,slug,category,platforms\(name,slug\)\)/);
assert.match(checkout, /\.eq\("user_id", user\.id\)/);
assert.match(checkout, /if \(!order\) return null/);
assert.match(checkout, /if \(walletError\) throw walletError/);

assert.ok(
  service.indexOf("await getCatalogService(slug)") < service.indexOf('.from("service_input_fields")'),
  "dynamic-input schema lookup still depends on the resolved service ID",
);
assert.ok(
  orderHistory.indexOf('await db.from("services")') < orderHistory.indexOf("await query.order("),
  "service-name search lookup remains before the filtered paginated order query",
);
assert.ok(
  walletPage.indexOf('await db.from("wallets")') < walletPage.indexOf("await txQuery.order("),
  "wallet transaction query remains dependent on the wallet ID",
);

for (const [path, expectedVariant] of [
  ["app/account/layout.tsx", "dashboard"],
  ["app/new-order/layout.tsx", "catalog"],
  ["app/services/[service]/layout.tsx", "service"],
]) {
  const source = fs.readFileSync(path, "utf8");
  assert.match(source, /AuthenticatedDashboardLayout/);
  assert.match(source, new RegExp(`loadingVariant="${expectedVariant}"`));
  assert.doesNotMatch(source, /await requireUser/);
}

console.log("customer-performance-batch4-tests: passed");
