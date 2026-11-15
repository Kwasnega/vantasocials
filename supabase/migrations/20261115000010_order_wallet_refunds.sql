-- 20261115000010_order_wallet_refunds.sql
-- Enables one-click and automated customer wallet refunds for failed, unfulfilled orders.
-- Idempotent, ledger-backed, with concurrency locking and mutual exclusion with retry.

-- 1. Add refund columns to orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS refund_status text NOT NULL DEFAULT 'NONE' CHECK (refund_status IN ('NONE', 'REFUNDED')),
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS refunded_by text NULL,
  ADD COLUMN IF NOT EXISTS refund_amount numeric(18,2) NULL CHECK (refund_amount IS NULL OR refund_amount >= 0);

-- 2. Index for filtering orders by refund_status
CREATE INDEX IF NOT EXISTS orders_refund_status_created_idx
  ON public.orders (refund_status, created_at DESC);

-- 3. App Settings for auto-refund
INSERT INTO public.app_settings (key, value, updated_at)
VALUES
  ('auto_refund_enabled', 'false'::jsonb, timezone('utc', now())),
  ('auto_refund_after_hours', '72'::jsonb, timezone('utc', now())),
  ('auto_refund_max_per_run', '50'::jsonb, timezone('utc', now())),
  ('auto_refund_daily_cap_ghs', '500.00'::jsonb, timezone('utc', now()))
ON CONFLICT (key) DO NOTHING;

-- 4. Atomic process_order_refund function
-- Returns row from wallet_transactions along with order details
CREATE OR REPLACE FUNCTION public.process_order_refund(
  p_order_id uuid,
  p_refunded_by text,
  p_reason text,
  p_force_ambiguous boolean DEFAULT false
)
RETURNS TABLE (
  success boolean,
  already_refunded boolean,
  transaction_id uuid,
  refund_amount numeric(18,2),
  wallet_id uuid,
  error_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_wallet public.wallets;
  v_existing_tx public.wallet_transactions;
  v_refund_tx public.wallet_transactions;
  v_refund_ref text := 'wallet-refund:order:' || p_order_id::text;
  v_amount_minor bigint;
  v_has_provider_order boolean;
  v_is_ambiguous boolean;
BEGIN
  -- Security check: service_role or admin authenticated only
  IF coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    -- Check if authenticated admin
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('ADMIN', 'SUPER_ADMIN')
    ) THEN
      RAISE EXCEPTION 'UNAUTHORIZED' USING errcode = '42501';
    END IF;
  END IF;

  -- 1. Lock and fetch order
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false, NULL::uuid, NULL::numeric, NULL::uuid, 'ORDER_NOT_FOUND'::text;
    RETURN;
  END IF;

  -- 2. Check if already refunded
  IF v_order.refund_status = 'REFUNDED' THEN
    SELECT * INTO v_existing_tx FROM public.wallet_transactions WHERE reference = v_refund_ref;
    RETURN QUERY SELECT true, true, v_existing_tx.id, v_order.refund_amount, v_existing_tx.wallet_id, 'ALREADY_REFUNDED'::text;
    RETURN;
  END IF;

  -- 3. Check payment status
  IF v_order.payment_status <> 'PAID' THEN
    RETURN QUERY SELECT false, false, NULL::uuid, NULL::numeric, NULL::uuid, 'ORDER_NOT_PAID'::text;
    RETURN;
  END IF;

  -- 4. Currency and amount validation
  IF v_order.currency <> 'GHS' OR v_order.total IS NULL OR v_order.total <= 0 THEN
    RETURN QUERY SELECT false, false, NULL::uuid, NULL::numeric, NULL::uuid, 'INVALID_AMOUNT_OR_CURRENCY'::text;
    RETURN;
  END IF;

  v_amount_minor := round(v_order.total * 100)::bigint;

  -- 5. Check if any provider order exists with external provider_order_id
  SELECT EXISTS (
    SELECT 1 FROM public.provider_orders
    WHERE order_id = p_order_id
      AND provider_order_id IS NOT NULL
      AND length(trim(provider_order_id)) > 0
  ) INTO v_has_provider_order;

  IF v_has_provider_order THEN
    RETURN QUERY SELECT false, false, NULL::uuid, NULL::numeric, NULL::uuid, 'PROVIDER_ORDER_EXISTS'::text;
    RETURN;
  END IF;

  -- 6. Check ambiguous state (e.g. SUBMITTING or UNKNOWN_PENDING_RECONCILIATION or provider_timeout)
  v_is_ambiguous := (
    v_order.fulfillment_status = 'SUBMITTING' OR
    v_order.failure_reason IN ('provider_timeout', 'unknown') OR
    EXISTS (
      SELECT 1 FROM public.provider_orders
      WHERE order_id = p_order_id
        AND attempt_status = 'UNKNOWN_PENDING_RECONCILIATION'
    )
  );

  IF v_is_ambiguous AND NOT p_force_ambiguous THEN
    RETURN QUERY SELECT false, false, NULL::uuid, NULL::numeric, NULL::uuid, 'AMBIGUOUS_STATE_REQUIRES_EXPLICIT_CONFIRMATION'::text;
    RETURN;
  END IF;

  -- 7. Ensure customer wallet exists (idempotent lock / creation)
  INSERT INTO public.wallets (user_id, currency, balance_minor)
  VALUES (v_order.user_id, 'GHS', 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_order.user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false, NULL::uuid, NULL::numeric, NULL::uuid, 'WALLET_NOT_FOUND'::text;
    RETURN;
  END IF;

  -- 8. Insert ledger entry into wallet_transactions
  -- On conflict with the unique reference, return existing entry idempotently
  INSERT INTO public.wallet_transactions (
    wallet_id,
    type,
    direction,
    status,
    amount_minor,
    currency,
    reference,
    order_id,
    metadata
  )
  VALUES (
    v_wallet.id,
    'REFUND',
    'CREDIT',
    'COMPLETED',
    v_amount_minor,
    'GHS',
    v_refund_ref,
    p_order_id,
    jsonb_build_object(
      'source', 'order_wallet_refund',
      'reason', coalesce(p_reason, 'Failed order refund'),
      'refunded_by', p_refunded_by,
      'forced_ambiguous', p_force_ambiguous
    )
  )
  ON CONFLICT (reference) DO NOTHING
  RETURNING * INTO v_refund_tx;

  -- If conflict occurred (already inserted concurrently)
  IF v_refund_tx.id IS NULL THEN
    SELECT * INTO v_refund_tx FROM public.wallet_transactions WHERE reference = v_refund_ref;
  END IF;

  -- 9. Update order refund columns and status
  UPDATE public.orders
  SET
    refund_status = 'REFUNDED',
    refunded_at = timezone('utc', now()),
    refunded_by = p_refunded_by,
    refund_amount = v_order.total,
    updated_at = timezone('utc', now())
  WHERE id = p_order_id;

  -- 10. Record order timeline event
  INSERT INTO public.order_events (
    order_id,
    type,
    status_before,
    status_after,
    message,
    actor,
    meta
  )
  VALUES (
    p_order_id,
    'order_refunded',
    v_order.fulfillment_status,
    v_order.fulfillment_status,
    'Refunded GHS ' || trim(to_char(v_order.total, '999999990.00')) || ' to customer wallet. Reason: ' || coalesce(p_reason, 'Failed order refund'),
    p_refunded_by,
    jsonb_build_object(
      'amount_minor', v_amount_minor,
      'amount_ghs', v_order.total,
      'reference', v_refund_ref,
      'wallet_transaction_id', v_refund_tx.id,
      'forced_ambiguous', p_force_ambiguous,
      'reason', p_reason
    )
  );

  RETURN QUERY SELECT true, false, v_refund_tx.id, v_order.total, v_wallet.id, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.process_order_refund(uuid, text, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.process_order_refund(uuid, text, text, boolean) TO authenticated, service_role;
