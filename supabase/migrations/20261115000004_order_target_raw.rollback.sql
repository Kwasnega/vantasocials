-- Rollback: Remove target_raw column from orders
ALTER TABLE public.orders DROP COLUMN IF EXISTS target_raw;
