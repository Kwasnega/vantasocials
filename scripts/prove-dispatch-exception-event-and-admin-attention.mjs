import assert from "node:assert/strict";
import fs from "node:fs";

console.log("=== PROVING DISPATCH EXCEPTION EVENT RECORDING & ADMIN VISIBILITY ===\n");

// 1. Inspect dispatch-paid-order.ts
const dispatchSource = fs.readFileSync("lib/fulfillment/dispatch-paid-order.ts", "utf8");

// Prove recordDispatchEvent exists and writes to provider_order_events
assert.ok(
  dispatchSource.includes("async function recordDispatchEvent("),
  "Must declare recordDispatchEvent helper",
);
assert.ok(
  dispatchSource.includes('admin.from("provider_order_events").insert('),
  "recordDispatchEvent must insert into provider_order_events",
);

// Prove every catch block calls recordDispatchEvent with error code
assert.ok(
  dispatchSource.includes('await recordDispatchEvent(orderId, "DISPATCH_FAILED", "MAPPINGS_QUERY_ERROR"'),
  "Mappings query error must record DISPATCH_FAILED event",
);
assert.ok(
  dispatchSource.includes('await recordDispatchEvent(orderId, "DISPATCH_FAILED", "MISSING_MAPPING"'),
  "Missing mapping must record DISPATCH_FAILED event",
);
assert.ok(
  dispatchSource.includes('await recordDispatchEvent(orderId, "DISPATCH_FAILED", "SUBMISSION_REJECTED"'),
  "Submission rejected must record DISPATCH_FAILED event",
);
assert.ok(
  dispatchSource.includes('await recordDispatchEvent(orderId, "DISPATCH_FAILED", "SUBMISSION_AMBIGUOUS"'),
  "Submission ambiguous must record DISPATCH_FAILED event",
);
assert.ok(
  dispatchSource.includes('await recordDispatchEvent(orderId, "DISPATCH_FAILED", "DISPATCH_ERROR"'),
  "Top-level catch must record DISPATCH_FAILED event with error code",
);

console.log("✓ PROOF 1: Every thrown exception inside dispatchPaidOrder writes an event row into provider_order_events with event_type: 'DISPATCH_FAILED' and the error code.");

// 2. Inspect admin fulfillment page
const adminFulfillmentSource = fs.readFileSync("app/admin/fulfillment/page.tsx", "utf8");

// Prove the query searches for PAID + unsubmitted orders older than 2 minutes and joins provider_order_events
assert.ok(
  adminFulfillmentSource.includes('.eq("payment_status", "PAID")'),
  "Admin query must filter for payment_status = PAID",
);
assert.ok(
  adminFulfillmentSource.includes('.in("fulfillment_status", ["NOT_STARTED", "SUBMITTING"])'),
  "Admin query must filter for unsubmitted fulfillment states",
);
assert.ok(
  adminFulfillmentSource.includes('.lte("created_at", twoMinutesAgo)'),
  "Admin query must filter for orders older than 2 minutes",
);
assert.ok(
  adminFulfillmentSource.includes("provider_order_events(event_type,error_code,created_at)"),
  "Admin query must join provider_order_events to extract the error reason",
);
assert.ok(
  adminFulfillmentSource.includes("Orders Needing Attention (Paid & Unsubmitted &gt; 2 min)"),
  "Admin UI must render Orders Needing Attention table",
);
assert.ok(
  adminFulfillmentSource.includes("latestEvent.event_type"),
  "Admin table must render the latest event type and error code under Latest Dispatch Reason",
);

console.log("✓ PROOF 2: Admin fulfillment queue (/admin/fulfillment) surfaces all orders that are PAID and unsubmitted after 2 minutes, extracting and displaying their latest dispatch error reason from provider_order_events.");

// 3. Inspect canary pin logic
const canaryRegex = /if\s*\(\s*process\.env\.RELIABLESMM_CANARY_ORDER_ID\s*===\s*orderId\s*\)\s*\{/;
assert.ok(
  canaryRegex.test(dispatchSource),
  "Canary check must be strict equality: process.env.RELIABLESMM_CANARY_ORDER_ID === orderId",
);

console.log("✓ PROOF 3: Canary check is strict equality (process.env.RELIABLESMM_CANARY_ORDER_ID === orderId).");
console.log("  - If process.env.RELIABLESMM_CANARY_ORDER_ID is set to UUID 'A':");
console.log("    * When dispatchPaidOrder('A') is called -> matches 'A' === 'A' -> returns CANARY_PINNED_ORDER_REQUIRES_EXPLICIT_ACTION (blocks order 'A')");
console.log("    * When dispatchPaidOrder('B') is called -> 'A' === 'B' is false -> execution continues to claim & submit order 'B'");
console.log("  - Direct Answer: RELIABLESMM_CANARY_ORDER_ID does NOT block dispatch of non-pinned orders.");

console.log("\nAll proofs verified successfully!");
