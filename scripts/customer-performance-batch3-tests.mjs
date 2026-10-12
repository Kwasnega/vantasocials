import assert from "node:assert/strict";
import fs from "node:fs";

const component = fs.readFileSync("components/dashboard/CustomerRouteLoading.tsx", "utf8");
const boundaries = [
  ["app/account/loading.tsx", "overview"],
  ["app/account/orders/loading.tsx", "orders"],
  ["app/account/orders/[id]/loading.tsx", "order-detail"],
  ["app/account/wallet/loading.tsx", "wallet"],
  ["app/account/settings/loading.tsx", "settings"],
  ["app/account/settings/[section]/loading.tsx", "setting-detail"],
  ["app/new-order/loading.tsx", "catalog"],
  ["app/services/[service]/loading.tsx", "service"],
  ["app/checkout/loading.tsx", "checkout"],
];

for (const [path, variant] of boundaries) {
  const source = fs.readFileSync(path, "utf8");
  assert.match(source, /CustomerRouteLoading/, `${path} must use the customer skeleton`);
  assert.match(source, new RegExp(`variant="${variant}"`), `${path} must match its route`);
}

assert.match(component, /role="status"/);
assert.match(component, /aria-live="polite"/);
assert.match(component, /aria-busy="true"/);
assert.match(component, /aria-label=\{`Loading \$\{labels\[variant\]\}`\}/);
assert.match(component, /aria-hidden="true"/, "visual placeholders should be hidden from assistive technology");

const sidebar = fs.readFileSync("components/dashboard/AccountSidebar.tsx", "utf8");
assert.match(sidebar, /<Link[^>]+href=\{item\.href\}/, "account navigation should remain App Router navigation");
assert.doesNotMatch(sidebar, /window\.location/, "account navigation should not force document reloads");

const layout = fs.readFileSync("app/account/layout.tsx", "utf8");
assert.match(layout, /AuthenticatedDashboardLayout/);
const authenticatedLayout = fs.readFileSync(
  "components/dashboard/AuthenticatedDashboardLayout.tsx",
  "utf8",
);
assert.match(authenticatedLayout, /<AccountSidebar/);
assert.match(authenticatedLayout, /<section className="dashboard-content">\{children\}<\/section>/);

console.log("customer-performance-batch3-tests: passed");
