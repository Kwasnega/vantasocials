-- Rollback: Remove target_preview column from orders
ALTER TABLE public.orders DROP COLUMN IF EXISTS target_preview;
