-- Rollback: 20261115000008_order_target_fixes.sql
DROP TABLE IF EXISTS public.order_fix_tokens;
DROP TABLE IF EXISTS public.order_target_edits;

ALTER TABLE public.orders
  DROP COLUMN IF EXISTS target_fix_status;
