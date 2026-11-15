-- 20261115000012_manual_wallet_adjustments.sql
-- Enables atomic, idempotent manual wallet credits/adjustments by admins for customer compensation.

-- 1. App setting for maximum allowable manual adjustment in GHS
INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('manual_adjustment_max_ghs', '500.00'::jsonb, timezone('utc', now()))
ON CONFLICT (key) DO NOTHING;

-- 2. Atomic SQL Function: credit_customer_wallet_manual
CREATE OR REPLACE FUNCTION public.credit_customer_wallet_manual(
  p_customer_id uuid,
  p_admin_id uuid,
  p_amount_minor bigint,
  p_idempotency_key text,
  p_reason_category text,
  p_internal_note text,
  p_linked_order_id uuid DEFAULT NULL
)
RETURNS TABLE (
  success boolean,
  already_credited boolean,
  transaction_id uuid,
  credited_amount_minor bigint,
  new_balance_minor bigint,
  error_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.wallets;
  v_tx public.wallet_transactions;
  v_reference text;
  v_max_cap_ghs numeric(18,2);
  v_max_cap_minor bigint;
BEGIN
  -- 1. Authorization check: service_role or authenticated admin
  IF coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
    ) THEN
      RAISE EXCEPTION 'UNAUTHORIZED' USING errcode = '42501';
    END IF;
  END IF;

  -- 2. Validate amount
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
    RETURN QUERY SELECT false, false, NULL::uuid, 0::bigint, 0::bigint, 'INVALID_AMOUNT'::text;
    RETURN;
  END IF;

  -- 3. Read and enforce safety cap from app_settings
  SELECT coalesce((value #>> '{}')::numeric, 500.00)
  INTO v_max_cap_ghs
  FROM public.app_settings
  WHERE key = 'manual_adjustment_max_ghs';

  v_max_cap_minor := round(coalesce(v_max_cap_ghs, 500.00) * 100)::bigint;
  IF p_amount_minor > v_max_cap_minor THEN
    RETURN QUERY SELECT false, false, NULL::uuid, 0::bigint, 0::bigint, ('EXCEEDS_MAX_CAP: Max allowable adjustment is GHS ' || v_max_cap_ghs::text)::text;
    RETURN;
  END IF;

  -- 4. Reference and idempotency key check
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 8 THEN
    RETURN QUERY SELECT false, false, NULL::uuid, 0::bigint, 0::bigint, 'INVALID_IDEMPOTENCY_KEY'::text;
    RETURN;
  END IF;

  v_reference := 'manual-adjustment:' || trim(p_idempotency_key);

  -- Check if already executed with this reference
  SELECT * INTO v_tx FROM public.wallet_transactions WHERE reference = v_reference;
  IF FOUND THEN
    SELECT * INTO v_wallet FROM public.wallets WHERE id = v_tx.wallet_id;
    RETURN QUERY SELECT true, true, v_tx.id, v_tx.amount_minor, v_wallet.balance_minor, 'ALREADY_CREDITED'::text;
    RETURN;
  END IF;

  -- 5. Ensure customer wallet exists and lock it
  INSERT INTO public.wallets (user_id, currency, balance_minor)
  VALUES (p_customer_id, 'GHS', 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false, NULL::uuid, 0::bigint, 0::bigint, 'WALLET_NOT_FOUND'::text;
    RETURN;
  END IF;

  -- 6. Insert transaction into wallet_transactions
  -- The existing trigger apply_wallet_transaction_projection automatically updates wallet.balance_minor!
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
    'MANUAL_ADJUSTMENT',
    'CREDIT',
    'COMPLETED',
    p_amount_minor,
    'GHS',
    v_reference,
    p_linked_order_id,
    jsonb_build_object(
      'source', 'admin_manual_adjustment',
      'admin_id', p_admin_id,
      'reason_category', coalesce(p_reason_category, 'other'),
      'internal_note', coalesce(p_internal_note, ''),
      'customer_description', 'Account credit from VANTA support',
      'idempotency_key', p_idempotency_key
    )
  )
  ON CONFLICT (reference) DO NOTHING
  RETURNING * INTO v_tx;

  -- In case of concurrent identical insertion
  IF v_tx.id IS NULL THEN
    SELECT * INTO v_tx FROM public.wallet_transactions WHERE reference = v_reference;
    SELECT * INTO v_wallet FROM public.wallets WHERE id = v_tx.wallet_id;
    RETURN QUERY SELECT true, true, v_tx.id, v_tx.amount_minor, v_wallet.balance_minor, 'ALREADY_CREDITED'::text;
    RETURN;
  END IF;

  -- Refetch updated wallet balance
  SELECT * INTO v_wallet FROM public.wallets WHERE id = v_wallet.id;

  RETURN QUERY SELECT true, false, v_tx.id, p_amount_minor, v_wallet.balance_minor, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_customer_wallet_manual(uuid, uuid, bigint, text, text, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.credit_customer_wallet_manual(uuid, uuid, bigint, text, text, text, uuid) TO authenticated, service_role;
