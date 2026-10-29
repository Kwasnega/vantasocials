/**
 * STAGING ONLY: Database Scale Seeding and Query Analysis Script
 * 
 * ⚠️ NEVER RUN THIS SCRIPT AGAINST PRODUCTION ⚠️
 * This script is intentionally protected to only execute if STAGING_SUPABASE_URL
 * and STAGING_SERVICE_ROLE_KEY are explicitly provided.
 */

import { createClient } from "@supabase/supabase-js";

const stagingUrl = process.env.STAGING_SUPABASE_URL;
const stagingKey = process.env.STAGING_SERVICE_ROLE_KEY;

if (!stagingUrl || !stagingKey || process.env.NODE_ENV === "production") {
  console.error(`
[SAFETY GUARD BLOCKED]
Scale seeding is strictly restricted to STAGING environments.
Set STAGING_SUPABASE_URL and STAGING_SERVICE_ROLE_KEY before running.
Do NOT use production credentials.
  `);
  process.exit(1);
}

const supabase = createClient(stagingUrl, stagingKey);

console.log("=== STAGING SCALE TEST PLAN & EXPLAIN ANALYZE QUERIES ===");

/**
 * EXPLAIN (ANALYZE, BUFFERS) Queries to run in Staging SQL Console after seeding:
 */

export const SCALE_EXPLAIN_QUERIES = `
-- 1. Fuzzy order search by public_order_id using Trigram GIN index:
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, public_order_id, user_id, status, payment_status, created_at
FROM orders
WHERE public_order_id ILIKE '%VNT-998%'
ORDER BY created_at DESC
LIMIT 50;

-- 2. Customer search by partial email with Trigram GIN index:
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, email, created_at
FROM profiles
WHERE email ILIKE '%john.doe%'
ORDER BY created_at DESC
LIMIT 50;

-- 3. Filtered Orders view with administrative status compound index:
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, public_order_id, fulfillment_status, payment_status, created_at
FROM orders
WHERE payment_status = 'PAID' AND fulfillment_status = 'SUBMITTING'
ORDER BY created_at DESC, id DESC
LIMIT 25;

-- 4. Deep Keyset Pagination Cursor query (Order created_at + id tie-breaker):
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, public_order_id, created_at
FROM orders
WHERE created_at < '2026-01-01T00:00:00Z'
   OR (created_at = '2026-01-01T00:00:00Z' AND id < '00000000-0000-0000-0000-000000000000')
ORDER BY created_at DESC, id DESC
LIMIT 50;
`;

console.log(SCALE_EXPLAIN_QUERIES);
