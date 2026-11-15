-- Migration: 20261115000008_order_target_fixes.sql
-- Description: Schema support for target editing, audit history, fix tokens, and status tracking.

-- 1. Add target_fix_status to orders table
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS target_fix_status text
    DEFAULT 'NONE'
    CHECK (target_fix_status IN ('NONE', 'AWAITING_CUSTOMER', 'FIXED', 'EXPIRED'));

COMMENT ON COLUMN public.orders.target_fix_status IS
  'Tracks status of target correction for failed orders: NONE, AWAITING_CUSTOMER, FIXED, EXPIRED.';

-- 2. Audit table for all target edits (admin or customer)
CREATE TABLE IF NOT EXISTS public.order_target_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  old_target text NOT NULL,
  new_target text NOT NULL,
  edited_by text NOT NULL, -- e.g. 'admin:<uuid>' or 'customer'
  reason text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS order_target_edits_order_id_idx
  ON public.order_target_edits(order_id, created_at DESC);

-- 3. Table for secure single-use customer fix tokens (storing SHA-256 hash only)
CREATE TABLE IF NOT EXISTS public.order_fix_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  last_sent_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  send_count int NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS order_fix_tokens_token_hash_idx
  ON public.order_fix_tokens(token_hash);

CREATE INDEX IF NOT EXISTS order_fix_tokens_order_id_idx
  ON public.order_fix_tokens(order_id);

-- Enable RLS
ALTER TABLE public.order_target_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_fix_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.order_target_edits FROM anon, authenticated;
REVOKE ALL ON public.order_fix_tokens FROM anon, authenticated;

CREATE POLICY "order_target_edits_service_role" ON public.order_target_edits
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "order_fix_tokens_service_role" ON public.order_fix_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);
