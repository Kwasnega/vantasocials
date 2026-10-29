import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath = "supabase/migrations/20261027000001_bundleup_gateway_reference_tombstones_and_admin_wipe.sql";
const gatewayMigrationPath = "supabase/migrations/20261027000000_bundleup_gateway_atomic_settlement.sql";
const wipeMigrationPath = "supabase/migrations/20261017000000_admin_data_wipe.sql";
const adminUiPath = "app/admin/settings/AdminDataWipe.tsx";
const migration = fs.readFileSync(migrationPath, "utf8");
const gatewayMigration = fs.readFileSync(gatewayMigrationPath, "utf8");
const originalWipeMigration = fs.readFileSync(wipeMigrationPath, "utf8");
const adminUi = fs.readFileSync(adminUiPath, "utf8");

function functionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Missing function: ${signature}`);
  const end = source.indexOf("$$;", start);
  assert.notEqual(end, -1, `Unterminated function: ${signature}`);
  return source.slice(start, end + 3);
}

function indexOfInOrder(source, fragments) {
  let previousIndex = -1;
  for (const fragment of fragments) {
    const index = source.indexOf(fragment);
    assert.ok(index > previousIndex, `Expected "${fragment}" after the preceding SQL operation`);
    previousIndex = index;
  }
}

const claimFunction = functionBody(
  gatewayMigration,
  "create or replace function public.claim_paystack_provider_reference(",
);
const wipeFunction = functionBody(
  migration,
  "create or replace function public.admin_wipe_order_financial_data(",
);

assert.match(migration, /alter column payment_id drop not null/i);
assert.match(
  migration,
  /drop constraint payment_provider_reference_claims_payment_id_fkey;\s*alter table public\.payment_provider_reference_claims\s+add constraint payment_provider_reference_claims_payment_id_fkey\s+foreign key \(payment_id\)\s+references public\.payments\(id\)\s+on delete set null/i,
);
assert.match(gatewayMigration, /primary key \(provider, actual_provider_reference\)/i);
assert.match(gatewayMigration, /extensions\.digest\(/i);
assert.doesNotMatch(gatewayMigration, /public\.digest\(/i);
assert.doesNotMatch(migration, /delete\s+from\s+public\.payment_provider_reference_claims/i);
assert.doesNotMatch(migration, /update\s+public\.payment_provider_reference_claims/i);
assert.match(claimFunction, /on conflict \(provider, actual_provider_reference\) do nothing/i);
assert.match(claimFunction, /if v_existing_payment_id is distinct from p_payment_id then/i);
assert.match(claimFunction, /PROVIDER_REFERENCE_ALREADY_CLAIMED/i);

console.log("claim contract: repeated same-payment claim is idempotent; a NULL tombstone cannot be reassigned");

assert.match(wipeFunction, /request\.jwt\.claim\.role[\s\S]*?'service_role'/);
assert.match(wipeFunction, /p_confirmation is distinct from 'WIPE ALL DATA'/);
assert.match(wipeFunction, /in access exclusive mode/);
indexOfInOrder(wipeFunction, [
  "public.webhook_events,",
  "public.orders,",
  "public.payments,",
  "public.bundleup_gateway_reconciliation_requests,",
  "public.bundleup_gateway_payment_evidence,",
  "public.payment_provider_reference_claims,",
]);
assert.match(wipeFunction, /where status = 'PENDING'[\s\S]*?WIPE_BLOCKED_PENDING_PAYMENT/);
assert.match(wipeFunction, /WIPE_BLOCKED_PENDING_DEPOSIT/);
assert.match(wipeFunction, /WIPE_BLOCKED_ACTIVE_WEBHOOK/);
assert.match(wipeFunction, /WIPE_BLOCKED_ACTIVE_FULFILLMENT/);
indexOfInOrder(wipeFunction, [
  "delete from public.bundleup_gateway_payment_evidence;",
  "delete from public.bundleup_gateway_reconciliation_requests;",
  "delete from public.payments;",
  "delete from public.orders;",
]);
assert.match(wipeFunction, /update public\.wallets set balance_minor = 0;/);
assert.doesNotMatch(wipeFunction, /exception\s+when/i);

const responseKeys = [
  "orders",
  "payments",
  "wallet_deposits",
  "wallet_transactions",
  "provider_orders",
  "provider_events",
  "fulfillment_claims",
  "paystack_webhook_events",
];
for (const key of responseKeys) {
  assert.match(wipeFunction, new RegExp(`'${key}'\\s*,`));
  assert.ok(adminUi.includes(`"${key}"`), `Admin UI no longer accepts response key ${key}`);
}

assert.match(originalWipeMigration, /create or replace function public\.admin_wipe_order_financial_data/);
assert.match(
  migration,
  /revoke all on function public\.admin_wipe_order_financial_data\(text\) from public, anon, authenticated;\s*grant execute on function public\.admin_wipe_order_financial_data\(text\) to service_role;/i,
);
assert.match(migration, /security definer\s+set search_path = public/i);

const settlementFunction = functionBody(
  gatewayMigration,
  "create or replace function public.settle_bundleup_gateway_order_payment(",
);
const lockedSettlementReads = [
  /select o\.\* into v_order[\s\S]*?from public\.orders o[\s\S]*?for update;/,
  /select p\.\* into v_payment[\s\S]*?from public\.payments p[\s\S]*?for update;/,
  /select r\.\* into v_request[\s\S]*?from public\.bundleup_gateway_reconciliation_requests r[\s\S]*?for update;/,
  /select e\.\* into v_existing_evidence[\s\S]*?from public\.bundleup_gateway_payment_evidence e[\s\S]*?for update;/,
].map((pattern) => {
  const match = pattern.exec(settlementFunction);
  assert.ok(match, `Settlement function is missing locked read matching ${pattern}`);
  return match.index;
});
assert.ok(
  lockedSettlementReads.every((index, i) => i === 0 || index > lockedSettlementReads[i - 1]),
  "Settlement lock order changed",
);
assert.match(settlementFunction, /payment_id = p_payment_id/);
assert.match(settlementFunction, /update public\.payments[\s\S]*?status = 'PAID'/);
assert.match(settlementFunction, /update public\.orders[\s\S]*?payment_status = 'PAID'/);

console.log("wipe contract: locks, guards, dependency deletion order, wallet preservation, and response keys are present");
console.log("settlement contract: settlement locks and payment/order updates remain in the gateway migration");
console.log("database rollback, FK execution, and concurrent transaction behavior require PostgreSQL integration tests");
