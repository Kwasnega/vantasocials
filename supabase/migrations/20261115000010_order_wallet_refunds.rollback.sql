-- 20261115000010_order_wallet_refunds.rollback.sql
-- Rollback for order_wallet_refunds migration

DROP FUNCTION IF EXISTS public.process_order_refund(uuid, text, text, boolean);

DELETE FROM public.app_settings
WHERE key IN (
  'auto_refund_enabled',
  'auto_refund_after_hours',
  'auto_refund_max_per_run',
  'auto_refund_daily_cap_ghs'
);

DROP INDEX IF EXISTS public.orders_refund_status_created_idx;

ALTER TABLE public.orders
  DROP COLUMN IF EXISTS refund_status,
  DROP COLUMN IF EXISTS refunded_at,
  DROP COLUMN IF EXISTS refunded_by,
  DROP COLUMN IF EXISTS refund_amount;
