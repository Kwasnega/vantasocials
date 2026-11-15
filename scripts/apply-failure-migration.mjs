// scripts/apply-failure-migration.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key);

const steps = [
  `ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS failure_reason text`,
  `ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS failure_detail text`,
  `ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0`,
  `ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz`,
  `ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS failed_at timestamptz`,
  `ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_failure_reason_check`,
  `ALTER TABLE public.orders ADD CONSTRAINT orders_failure_reason_check CHECK (
    failure_reason IS NULL OR failure_reason IN (
      'provider_insufficient_funds',
      'provider_rejected',
      'invalid_target',
      'provider_timeout',
      'provider_unreachable',
      'internal_error',
      'unknown'
    )
  )`,
  `CREATE INDEX IF NOT EXISTS orders_fulfillment_failure_idx ON public.orders (fulfillment_status, failure_reason) WHERE failure_reason IS NOT NULL`,
];

for (const sql of steps) {
  const preview = sql.replace(/\s+/g, ' ').trim().substring(0, 90);
  process.stdout.write(`Running: ${preview}...\n`);
  const { error } = await sb.rpc('exec_sql', { sql });
  if (error) {
    console.warn(`  Warning (may be benign): ${error.message}`);
  } else {
    console.log('  OK');
  }
}

// Verify columns exist
const { data, error } = await sb.from('orders').select('failure_reason,failure_detail,attempt_count,last_attempt_at,failed_at').limit(1);
if (error) {
  console.error('Column verification FAILED:', error.message);
  process.exit(1);
} else {
  console.log('\nColumns verified successfully!');
  console.log('Sample row keys:', Object.keys(data?.[0] ?? { failure_reason: null, failure_detail: null, attempt_count: 0, last_attempt_at: null, failed_at: null }));
}
