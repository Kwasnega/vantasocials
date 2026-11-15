-- 20261115000011_customer_management_and_notes.sql
-- Adds customer status management (ACTIVE, FLAGGED, SUSPENDED), customer notes/complaints,
-- customer status history audit, and atomic financial summary RPC for admin verification.

-- 1. Add account status columns to public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE', 'FLAGGED', 'SUSPENDED')),
  ADD COLUMN IF NOT EXISTS account_status_reason text NULL,
  ADD COLUMN IF NOT EXISTS status_updated_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS status_updated_by uuid REFERENCES auth.users(id) NULL;

CREATE INDEX IF NOT EXISTS profiles_account_status_idx
  ON public.profiles (account_status, created_at DESC);

-- 2. Customer Notes table (complaints, refund requests, verification, administrative notes)
CREATE TABLE IF NOT EXISTS public.customer_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  author_admin_id uuid NOT NULL REFERENCES auth.users(id),
  category text NOT NULL CHECK (category IN ('complaint', 'refund_request', 'verification', 'other')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  body text NOT NULL CHECK (length(trim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  resolved_at timestamptz NULL,
  resolved_by uuid REFERENCES auth.users(id) NULL
);

CREATE INDEX IF NOT EXISTS customer_notes_customer_created_idx
  ON public.customer_notes (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS customer_notes_customer_status_idx
  ON public.customer_notes (customer_id, status);

CREATE INDEX IF NOT EXISTS customer_notes_order_idx
  ON public.customer_notes (order_id)
  WHERE order_id IS NOT NULL;

-- 3. Customer Status History (immutable audit of flag / suspension / unsuspension events)
CREATE TABLE IF NOT EXISTS public.customer_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  old_status text NOT NULL,
  new_status text NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  changed_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS customer_status_history_customer_created_idx
  ON public.customer_status_history (customer_id, created_at DESC);

-- 4. RLS policies on customer_notes and customer_status_history
ALTER TABLE public.customer_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_status_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.customer_notes FROM anon, authenticated;
REVOKE ALL ON public.customer_status_history FROM anon, authenticated;

CREATE POLICY "customer_notes_service_role" ON public.customer_notes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "customer_status_history_service_role" ON public.customer_status_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. Atomic RPC: get_customer_financial_summary
-- Aggregates wallet balance, deposits, spend, refunds, ledger reconciliation, order counts, and open complaints
CREATE OR REPLACE FUNCTION public.get_customer_financial_summary(p_customer_id uuid)
RETURNS TABLE (
  wallet_balance_ghs numeric(18,2),
  wallet_currency text,
  total_deposited_ghs numeric(18,2),
  successful_deposits_count bigint,
  first_deposit_at timestamptz,
  last_deposit_at timestamptz,
  total_spent_ghs numeric(18,2),
  total_refunded_ghs numeric(18,2),
  refunds_count bigint,
  net_spent_ghs numeric(18,2),
  ledger_derived_balance_minor bigint,
  projected_balance_minor bigint,
  balance_matches boolean,
  total_orders_count bigint,
  completed_orders_count bigint,
  failed_orders_count bigint,
  open_complaints_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.wallets;
  v_dep_sum numeric(18,2) := 0.00;
  v_dep_cnt bigint := 0;
  v_dep_first timestamptz := null;
  v_dep_last timestamptz := null;
  v_orders_sum numeric(18,2) := 0.00;
  v_refunds_sum numeric(18,2) := 0.00;
  v_refunds_cnt bigint := 0;
  v_orders_cnt bigint := 0;
  v_orders_completed bigint := 0;
  v_orders_failed bigint := 0;
  v_complaints_cnt bigint := 0;
  v_ledger_minor bigint := 0;
  v_projected_minor bigint := 0;
BEGIN
  -- Restrict to service_role (called from server-side admin endpoints)
  IF coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
    ) THEN
      RAISE EXCEPTION 'UNAUTHORIZED' USING errcode = '42501';
    END IF;
  END IF;

  -- 1. Wallet balance
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_customer_id;
  v_projected_minor := coalesce(v_wallet.balance_minor, 0);

  -- 2. Deposits aggregation (COMPLETED only)
  SELECT
    coalesce(sum(amount_minor), 0) / 100.0,
    count(*),
    min(paid_at),
    max(paid_at)
  INTO v_dep_sum, v_dep_cnt, v_dep_first, v_dep_last
  FROM public.wallet_deposit_payments
  WHERE user_id = p_customer_id AND status = 'COMPLETED';

  -- 3. Orders aggregation (PAID only)
  SELECT
    coalesce(sum(total), 0.00),
    count(*),
    count(*) FILTER (WHERE fulfillment_status = 'COMPLETED'),
    count(*) FILTER (WHERE fulfillment_status = 'FAILED')
  INTO v_orders_sum, v_orders_cnt, v_orders_completed, v_orders_failed
  FROM public.orders
  WHERE user_id = p_customer_id AND payment_status = 'PAID';

  -- 4. Refunds aggregation
  SELECT
    coalesce(sum(refund_amount), 0.00),
    count(*)
  INTO v_refunds_sum, v_refunds_cnt
  FROM public.orders
  WHERE user_id = p_customer_id AND refund_status = 'REFUNDED';

  -- 5. Wallet ledger reconciliation check
  IF v_wallet.id IS NOT NULL THEN
    SELECT coalesce(
      sum(
        CASE
          WHEN status <> 'COMPLETED' THEN 0
          WHEN direction = 'CREDIT' THEN amount_minor
          WHEN direction = 'DEBIT' THEN -amount_minor
          ELSE 0
        END
      ), 0)
    INTO v_ledger_minor
    FROM public.wallet_transactions
    WHERE wallet_id = v_wallet.id;
  END IF;

  -- 6. Open complaints count
  SELECT count(*)
  INTO v_complaints_cnt
  FROM public.customer_notes
  WHERE customer_id = p_customer_id AND status = 'open' AND category = 'complaint';

  RETURN QUERY SELECT
    round(coalesce(v_projected_minor, 0) / 100.0, 2),
    coalesce(v_wallet.currency, 'GHS')::text,
    v_dep_sum,
    v_dep_cnt,
    v_dep_first,
    v_dep_last,
    greatest(0.00, v_orders_sum - v_refunds_sum),
    v_refunds_sum,
    v_refunds_cnt,
    greatest(0.00, v_dep_sum - round(coalesce(v_projected_minor, 0) / 100.0, 2)),
    v_ledger_minor,
    v_projected_minor,
    (v_ledger_minor = v_projected_minor),
    v_orders_cnt,
    v_orders_completed,
    v_orders_failed,
    v_complaints_cnt;
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_financial_summary(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_financial_summary(uuid) TO authenticated, service_role;
