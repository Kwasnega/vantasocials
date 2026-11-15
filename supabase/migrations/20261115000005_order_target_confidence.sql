-- Migration: Add target_confidence column to orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS target_confidence text DEFAULT 'high';
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_target_confidence_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_target_confidence_check CHECK (target_confidence IN ('high', 'low'));

COMMENT ON COLUMN public.orders.target_confidence IS 'Confidence rating of target canonicalization (high or low).';
