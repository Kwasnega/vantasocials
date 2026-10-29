import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const overview = read("app/admin/page.tsx");
const wallet = read("app/admin/wallet/page.tsx");
const provider = read("app/admin/providers/page.tsx");
const catalog = read("app/admin/provider-catalog/page.tsx");
const candidateControl = read("app/admin/services/MappingControl.tsx");
const settings = read("app/admin/settings/page.tsx");
const orders = read("app/admin/orders/page.tsx");
const orderDetail = read("app/admin/orders/[id]/page.tsx");
const fulfillment = read("app/admin/fulfillment/page.tsx");
const walletApi = read("app/api/admin/wallet/route.ts");
const catalogApi = read("app/api/admin/provider-catalog/route.ts");
const syncApi = read("app/api/admin/providers/reliablesmm/sync/route.ts");

assert.match(overview, /walletCount/);
assert.match(overview, /\.limit\(100\)/);
assert.match(overview, /not total liability/);
assert.doesNotMatch(overview, /Available liability across customer wallets/);
assert.match(overview, /walletsError \?/);
assert.match(overview, /recentError \?/);

assert.match(wallet, /walletsError \?/);
assert.match(wallet, /depositsError \?/);
assert.match(wallet, /transactionsError \?/);
assert.match(wallet, /latest 100/);
assert.match(wallet, /sample only, not global liability/);
assert.doesNotMatch(wallet, /Wallet liability/);

assert.match(provider, /healthError \?/);
assert.match(provider, /catalogError \?/);
assert.match(provider, /syncError \?/);
assert.match(overview, /import BalanceRefresh from "\.\/providers\/BalanceRefresh"/);
assert.match(overview, /<BalanceRefresh label="Reload balance" \/>/);
assert.match(catalog, /error \? <AdminQueryError/);
assert.match(candidateControl, /candidateLoadError/);
assert.match(candidateControl, /Pricing data could not be loaded/);
assert.match(catalogApi, /if \(mappedError\)/);
assert.match(walletApi, /if \(transactionsError\)/);
assert.match(syncApi, /if \(existingError\)/);
assert.match(syncApi, /if \(staleError\)/);
assert.match(syncApi, /if \(completionError\)/);

assert.match(settings, /href: "\/admin\/providers"/);
assert.doesNotMatch(settings, /\/admin\/providers\/reliablesmm/);
assert.match(orders, /"SUBMITTING", "SUBMITTED", "PROCESSING"/);
assert.match(orders, /\["PROCESSING", "SUBMITTING", "SUBMITTED"\]/);
assert.match(orderDetail, /paymentsError \?/);
assert.match(orderDetail, /providerOrdersError \?/);
assert.match(orderDetail, /walletEntriesError \?/);
assert.match(fulfillment, /\["SUBMITTED", "PROCESSING"\]/);
assert.match(fulfillment, /result\.error \?/);

console.log("admin-operational-visibility-tests: passed");
