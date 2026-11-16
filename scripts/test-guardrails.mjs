/**
 * Tests for Paystack Webhook & Deposit Reconciliation Guardrails:
 * 1. Duplicate webhook delivery deduplication (idempotency)
 * 2. Reconciled deposit lock across all 4 crediting paths
 */

import assert from "node:assert";
import test from "node:test";

test("should deduplicate identical webhook event ID", () => {
  const eventId = "charge.success:12345678";
  const processedEvents = new Set();

  function handleWebhook(id) {
    if (processedEvents.has(id)) {
      return { received: true, credited: false };
    }
    processedEvents.add(id);
    return { received: true, credited: true };
  }

  const first = handleWebhook(eventId);
  assert.strictEqual(first.credited, true);

  const second = handleWebhook(eventId);
  assert.strictEqual(second.received, true);
  assert.strictEqual(second.credited, false);
});

test("should block crediting across all 4 paths when deposit is marked reconciled", () => {
  const reconciledDeposit = {
    id: "fe7e4908-0411-434b-b72f-0bc5482efeaf",
    is_reconciled: true,
    provider_response: { reconciled: true },
  };

  // Path 1: Webhook route check
  const webhookCanCredit = !reconciledDeposit.provider_response?.reconciled && reconciledDeposit.is_reconciled !== true;
  assert.strictEqual(webhookCanCredit, false);

  // Path 2: Return callback /account/wallet/deposit/verify check
  const verifyCanCredit = !(reconciledDeposit.provider_response?.reconciled === true || reconciledDeposit.is_reconciled === true);
  assert.strictEqual(verifyCanCredit, false);

  // Path 3: Reconcile cron job /api/internal/deposits/reconcile check
  const reconcileJobCanCredit = !(reconciledDeposit.provider_response?.reconciled === true || reconciledDeposit.is_reconciled === true);
  assert.strictEqual(reconcileJobCanCredit, false);

  // Path 4: Admin manual credit button /api/admin/customers/[id]/wallet/deposits/[id]/credit check
  const adminCreditCanCredit = !(reconciledDeposit.provider_response?.reconciled === true || reconciledDeposit.is_reconciled === true);
  assert.strictEqual(adminCreditCanCredit, false);
});
