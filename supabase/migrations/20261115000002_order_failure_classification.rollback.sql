-- Rollback: 20261115000002_order_failure_classification.rollback.sql
-- Description: Remove failure classification columns from orders table

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_failure_reason_check;

DROP INDEX IF EXISTS public.orders_fulfillment_failure_idx;

ALTER TABLE public.orders
  DROP COLUMN IF EXISTS failure_reason,
  DROP COLUMN IF EXISTS failure_detail,
  DROP COLUMN IF EXISTS attempt_count,
  DROP COLUMN IF EXISTS last_attempt_at,
  DROP COLUMN IF EXISTS failed_at;
