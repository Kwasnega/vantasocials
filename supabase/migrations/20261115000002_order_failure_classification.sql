-- Migration: 20261115000002_order_failure_classification.sql
-- Description: Add failure classification columns to orders table

-- Add failure classification columns
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS failure_reason  text,
  ADD COLUMN IF NOT EXISTS failure_detail  text,
  ADD COLUMN IF NOT EXISTS attempt_count   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at       timestamptz;

-- Add CHECK constraint on failure_reason
-- Do it safely: drop if exists first, then add
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_failure_reason_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_failure_reason_check
  CHECK (
    failure_reason IS NULL OR failure_reason IN (
      'provider_insufficient_funds',
      'provider_rejected',
      'invalid_target',
      'provider_timeout',
      'provider_unreachable',
      'internal_error',
      'unknown'
    )
  );

-- Index for filtering failed orders by reason in the admin panel
CREATE INDEX IF NOT EXISTS orders_fulfillment_failure_idx
  ON public.orders (fulfillment_status, failure_reason)
  WHERE failure_reason IS NOT NULL;
