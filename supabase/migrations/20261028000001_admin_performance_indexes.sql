-- Migration: 20261028000001_admin_performance_indexes.sql
-- Description: Indexes for admin list filters, keyset ordering, and an SQL aggregation function for the admin dashboard.
-- Safe for execution in the Supabase SQL Editor and migration runners.

-- 1. Index for filtering orders by payment_status and fulfillment_status with created_at ordering
CREATE INDEX IF NOT EXISTS orders_payment_status_created_idx
  ON public.orders (payment_status, created_at DESC);

CREATE INDEX IF NOT EXISTS orders_fulfillment_status_created_idx
  ON public.orders (fulfillment_status, created_at DESC);

-- 2. Keyset pagination index on orders (created_at desc, id desc)
CREATE INDEX IF NOT EXISTS orders_created_at_id_desc_idx
  ON public.orders (created_at DESC, id DESC);

-- 3. Customer profile email index for search (text_pattern_ops for prefix)
CREATE INDEX IF NOT EXISTS profiles_email_idx
  ON public.profiles (email text_pattern_ops);

-- 4. Provider orders index for reconciliation and polling
CREATE INDEX IF NOT EXISTS provider_orders_status_poll_idx
  ON public.provider_orders (status, next_poll_at)
  WHERE status IN ('SUBMITTED', 'PROCESSING');

-- 5. Provider order events index by order_id
CREATE INDEX IF NOT EXISTS provider_order_events_order_id_idx
  ON public.provider_order_events (order_id, created_at DESC)
  WHERE order_id IS NOT NULL;

-- 6. Server-side SQL Aggregation for Admin Overview (Zero row egress into Node)
CREATE OR REPLACE FUNCTION public.get_admin_dashboard_metrics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orders_count bigint;
  v_customers_count bigint;
  v_wallet_liabilities jsonb;
  v_paid_count bigint;
  v_active_count bigint;
  v_result jsonb;
BEGIN
  -- Restrict to service_role (invoked via createSupabaseAdminClient server-side)
  IF coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING errcode = '42501';
  END IF;

  SELECT count(*) INTO v_orders_count FROM public.orders;
  SELECT count(*) INTO v_customers_count FROM public.profiles;

  -- Aggregate GHS wallet liability in-database (avoids pulling 1,000+ rows into Node)
  SELECT coalesce(sum(balance_minor), 0)
    INTO v_wallet_liabilities
    FROM public.wallets
   WHERE currency = 'GHS';

  SELECT count(*) INTO v_paid_count
    FROM public.orders
   WHERE payment_status = 'PAID';

  SELECT count(*) INTO v_active_count
    FROM public.orders
   WHERE fulfillment_status IN ('PROCESSING', 'SUBMITTING', 'SUBMITTED');

  SELECT jsonb_build_object(
    'orders_count', v_orders_count,
    'customers_count', v_customers_count,
    'ghs_balance_minor', coalesce(v_wallet_liabilities, '0'::jsonb),
    'paid_orders_count', v_paid_count,
    'active_orders_count', v_active_count,
    'catalog_service_count', (
      SELECT count(*)
        FROM public.provider_catalog_services
       WHERE provider = 'reliablesmm'
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Revoke from public/anon/authenticated; grant only to service_role
REVOKE ALL ON FUNCTION public.get_admin_dashboard_metrics() FROM public;
REVOKE ALL ON FUNCTION public.get_admin_dashboard_metrics() FROM anon;
REVOKE ALL ON FUNCTION public.get_admin_dashboard_metrics() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_metrics() TO service_role;
