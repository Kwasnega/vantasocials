-- Rollback: Remove target_confidence column from orders
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_target_confidence_check;
ALTER TABLE public.orders DROP COLUMN IF EXISTS target_confidence;
