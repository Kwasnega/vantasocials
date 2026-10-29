import assert from "node:assert/strict";
import fs from "node:fs";

const accountOrders = fs.readFileSync("app/account/orders/page.tsx", "utf8");
const accountOrderDetail = fs.readFileSync("app/account/orders/[id]/page.tsx", "utf8");
const accountWallet = fs.readFileSync("app/account/wallet/page.tsx", "utf8");
const walletRoute = fs.readFileSync("app/api/account/wallet/route.ts", "utf8");
const ordersRoute = fs.readFileSync("app/api/orders/route.ts", "utf8");
const walletDepositRoute = fs.readFileSync("app/api/account/wallet/deposit/route.ts", "utf8");
const walletPayRoute = fs.readFileSync("app/api/payments/wallet/route.ts", "utf8");
const initialSchema = fs.readFileSync("supabase/migrations/20260927000000_initial_schema.sql", "utf8");
const walletFoundation = fs.readFileSync("supabase/migrations/20260928000003_wallet_ledger_foundation.sql", "utf8");

// 1. Customer orders RLS policy
assert.match(initialSchema, /create policy "customers can view their orders" on public\.orders for select using \(auth\.uid\(\) = user_id\);/);

// 2. Wallets RLS policy
assert.match(walletFoundation, /create policy "customers can view their wallet" on public\.wallets for select using \(auth\.uid\(\) = user_id\);/);

// 3. Wallet transactions RLS policy
assert.match(walletFoundation, /create policy "customers can view their wallet transactions" on public\.wallet_transactions for select using \(exists \(select 1 from public\.wallets where wallets\.id = wallet_transactions\.wallet_id and wallets\.user_id = auth\.uid\(\)\)\);/);

// 4. API & Page queries always enforce user.id scoping
assert.match(accountOrders, /\.eq\("user_id",\s*user\.id\)/);
assert.match(accountOrderDetail, /\.eq\("user_id",\s*user\.id\)/);
assert.match(accountWallet, /\.eq\("user_id",\s*user\.id\)/);
assert.match(walletRoute, /\.eq\("user_id",\s*user\.id\)/);
assert.match(walletPayRoute, /\.eq\("user_id",\s*user\.id\)/);
assert.match(ordersRoute, /user_id:\s*user\.id/);
assert.match(walletDepositRoute, /\.eq\("user_id",\s*user\.id\)/);

console.log("cross-user-security-tests: passed");
