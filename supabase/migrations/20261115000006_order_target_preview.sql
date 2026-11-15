-- Migration: Add target_preview JSONB column to orders table
-- Description: Stores customer-facing preview snapshot (title, author, thumbnailUrl, fetchedAt) confirmed during ordering.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS target_preview jsonb;

COMMENT ON COLUMN public.orders.target_preview IS 'Snapshot of link preview (title, author, thumbnailUrl, fetchedAt) when available at checkout.';
