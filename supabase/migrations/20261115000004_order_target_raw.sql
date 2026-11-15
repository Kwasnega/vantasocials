-- Migration: Add target_raw column to orders for support/debugging original customer inputs
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS target_raw text;
COMMENT ON COLUMN public.orders.target_raw IS 'Original raw customer input for target before server canonicalization.';
