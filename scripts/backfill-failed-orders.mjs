// scripts/backfill-failed-orders.mjs
// Backfill failure_reason for existing orders where fulfillment_status indicates failure.
// SAFE: Only reads/writes failure classification fields. Does NOT change fulfillment_status.
//
// Usage: node --env-file=.env.local scripts/backfill-failed-orders.mjs
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf8');
const getEnv = (k) => {
  const m = env.match(new RegExp(`^${k}=["']?([^"'\r\n]+)["']?`, 'm'));
  return m ? m[1].trim() : process.env[k];
};

const sb = createClient(getEnv('NEXT_PUBLIC_SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Classify a raw error message string (pure, no imports needed) */
function classifyMessage(msg) {
  if (!msg) return 'unknown';
  const m = msg.toLowerCase();

  if (/timeout|timed[\s_-]out|etimedout|408/.test(m)) return 'provider_timeout';
  if (/econnrefused|ehostunreach|network[\s_]error|fetch failed|502|503|504|bad gateway|service unavailable/.test(m)) return 'provider_unreachable';
  if (/not enough balance|insufficient funds|insufficient balance|not enough funds|balance|insufficient/.test(m)) return 'provider_insufficient_funds';
  if (/invalid link|bad link|invalid url|invalid target|private profile|not found|page not found|link error|url error/.test(m)) return 'invalid_target';
  if (/mapping|schema|invalid quantity|eligibility|service_id|provider_service_id|inactive|not configured|missing api key|rate limit/.test(m)) return 'internal_error';
  if (msg.length > 0) return 'provider_rejected';
  return 'unknown';
}

function truncate(s, max = 500) {
  if (!s) return '';
  return s.length <= max ? s : s.substring(0, 497) + '...';
}

async function run() {
  console.log('=== BACKFILL: Order Failure Classification ===\n');

  // 1. Find orders that have no failure_reason but are in failed-related states
  //    (In this DB all PAID orders go through fulfillment, so we check provider_orders for errors)
  const { data: failedProviderOrders, error: poError } = await sb
    .from('provider_orders')
    .select('id,order_id,attempt_status,error_code,last_submission_error,last_submission_error_at')
    .or('attempt_status.eq.FAILED_BEFORE_SUBMISSION,attempt_status.eq.UNKNOWN_PENDING_RECONCILIATION');

  if (poError) {
    console.error('Failed to load provider_orders:', poError.message);
    process.exit(1);
  }

  console.log(`Found ${failedProviderOrders?.length ?? 0} failed provider order attempts\n`);

  const summary = {};
  let updated = 0;
  let skipped = 0;

  for (const po of failedProviderOrders ?? []) {
    if (!po.order_id) { skipped++; continue; }

    // Check if this order already has a failure_reason
    const { data: order, error: orderError } = await sb
      .from('orders')
      .select('id,failure_reason')
      .eq('id', po.order_id)
      .maybeSingle();

    if (orderError || !order) { skipped++; continue; }
    if (order.failure_reason) {
      // Already classified
      summary[order.failure_reason] = (summary[order.failure_reason] ?? 0) + 1;
      skipped++;
      continue;
    }

    // Determine source of error text
    const errorText = po.last_submission_error || po.error_code || '';
    const reason = classifyMessage(errorText);
    const detail = errorText
      ? truncate(`BACKFILL: ${errorText}`)
      : 'No error detail available at time of backfill';

    const now = new Date().toISOString();
    const { error: updateError } = await sb
      .from('orders')
      .update({
        failure_reason: reason,
        failure_detail: detail,
        last_attempt_at: po.last_submission_error_at ?? now,
      })
      .eq('id', po.order_id);

    if (updateError) {
      console.warn(`  Failed to update order ${po.order_id}:`, updateError.message);
      skipped++;
    } else {
      summary[reason] = (summary[reason] ?? 0) + 1;
      updated++;
    }
  }

  // Also check for orders with fulfillment_status = FAILED but no provider_order
  const { data: failedOrders, error: foError } = await sb
    .from('orders')
    .select('id,fulfillment_status,failure_reason')
    .eq('fulfillment_status', 'FAILED')
    .is('failure_reason', null);

  if (!foError && failedOrders && failedOrders.length > 0) {
    console.log(`\nFound ${failedOrders.length} FAILED orders with no failure_reason and no provider_order`);
    for (const order of failedOrders) {
      await sb
        .from('orders')
        .update({
          failure_reason: 'unknown',
          failure_detail: 'No error detail available - legacy failure',
          last_attempt_at: new Date().toISOString(),
        })
        .eq('id', order.id);
      summary['unknown'] = (summary['unknown'] ?? 0) + 1;
      updated++;
    }
  }

  console.log('\n=== BACKFILL RESULTS ===');
  console.log(`Updated: ${updated} orders`);
  console.log(`Skipped: ${skipped} (already classified or no order found)`);
  console.log('\nClassification breakdown:');
  for (const [reason, count] of Object.entries(summary)) {
    console.log(`  ${reason}: ${count}`);
  }
  console.log('\nDone! No fulfillment_status values were changed.');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
