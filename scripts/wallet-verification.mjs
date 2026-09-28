import fs from "node:fs";
const migration = fs.readFileSync("supabase/migrations/20260928000003_wallet_ledger_foundation.sql", "utf8");
const api = fs.readFileSync("app/api/account/wallet/route.ts", "utf8");
const adminApi = fs.readFileSync("app/api/admin/wallet/route.ts", "utf8");
const hardening = fs.readFileSync("supabase/migrations/20260928000004_wallet_ledger_hardening.sql", "utf8");
const walletPage = fs.readFileSync("app/account/wallet/page.tsx", "utf8");
const checks = [
  [migration.includes("create table public.wallets"), "wallet table"],
  [migration.includes("create table public.wallet_transactions"), "transaction ledger"],
  [migration.includes("amount_minor bigint") && migration.includes("currency = 'GHS'"), "integer GHS accounting"],
  [migration.includes("wallet_transactions_order_debit_idx"), "order debit uniqueness"],
  [migration.includes("debit_wallet_for_order") && migration.includes("INSUFFICIENT_FUNDS"), "guarded atomic debit function"],
  [migration.includes("customers can view their wallet") && migration.includes("customers can view their wallet transactions"), "customer RLS"],
  [api.includes("requireUser") && api.includes("projectedWallet"), "scoped customer wallet API"],
  [adminApi.includes("requireAdmin") && adminApi.includes("range"), "scoped paginated admin API"],
  [!migration.includes("PAYSTACK") && !migration.includes("provider_orders"), "no provider/payment integration"],
  [hardening.includes("balance_minor bigint") && hardening.includes("apply_wallet_transaction_projection"), "atomic balance projection"],
  [hardening.includes("reconcile_wallet") && hardening.includes("REFUND"), "reconciliation and refund operations"],
  [hardening.includes("WALLET_LEDGER_IMMUTABLE") && hardening.includes("refund_wallet_order"), "immutable idempotent refund path"],
  [api.includes("balance_minor") && !api.includes("entries"), "projected customer balance"],
  [adminApi.includes("balance_minor") && !adminApi.includes("wallet_balance_minor"), "set-based admin balances"],
  [hardening.includes("revoke all on function public.apply_wallet_transaction_projection()"), "projection function is not application-callable"],
  [hardening.includes("wallet_id = target_wallet.id") && hardening.includes("refund_wallet_order"), "refund wallet ownership validation"],
  [walletPage.includes("balance_minor") && !walletPage.includes('select("amount_minor,direction")'), "wallet page uses projection"],
  [hardening.includes("wallet_transaction_projection_after_insert") && hardening.includes("wallet_transactions_immutable"), "projection trigger and immutable ledger"],
  [hardening.includes("refund_wallet_order") && hardening.includes("refund_reference"), "refund idempotency"],
];
const failed = checks.filter(([ok]) => !ok);
if (failed.length) { console.error(`Wallet verification failed: ${failed.map(([, name]) => name).join(", ")}`); process.exit(1); }
console.log(`Wallet verification: PASS (${checks.length} checks)`);
