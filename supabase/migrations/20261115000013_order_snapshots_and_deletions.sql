-- Migration: 20261115000013_order_snapshots_and_deletions.sql
-- Description: Adds service/platform/provider name snapshots and archive status to orders,
-- and updates orders.service_id FK to ON DELETE SET NULL to allow deleting services with existing orders.

-- 1. Add snapshot columns and archive metadata to public.orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS service_name_snapshot text,
  ADD COLUMN IF NOT EXISTS platform_snapshot text,
  ADD COLUMN IF NOT EXISTS provider_name_snapshot text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_orders_archived_at ON public.orders(archived_at);

-- 2. Backfill snapshots from existing services and platforms
UPDATE public.orders o
SET
  service_name_snapshot = COALESCE(o.service_name_snapshot, s.name),
  platform_snapshot = COALESCE(o.platform_snapshot, p.name),
  provider_name_snapshot = COALESCE(o.provider_name_snapshot, s.provider)
FROM public.services s
LEFT JOIN public.platforms p ON p.id = s.platform_id
WHERE o.service_id = s.id
  AND (o.service_name_snapshot IS NULL OR o.platform_snapshot IS NULL OR o.provider_name_snapshot IS NULL);

-- 3. Modify orders.service_id foreign key constraint to ON DELETE SET NULL
-- Drop the existing constraint if present and re-add with SET NULL
DO $$
DECLARE
  v_con_name text;
BEGIN
  SELECT tc.constraint_name INTO v_con_name
  FROM information_schema.table_constraints AS tc
  JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_name = 'orders'
    AND kcu.column_name = 'service_id'
  LIMIT 1;

  IF v_con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.orders DROP CONSTRAINT %I', v_con_name);
  END IF;

  ALTER TABLE public.orders
    ALTER COLUMN service_id DROP NOT NULL;

  ALTER TABLE public.orders
    ADD CONSTRAINT orders_service_id_fkey
    FOREIGN KEY (service_id)
    REFERENCES public.services(id)
    ON DELETE SET NULL;
END $$;

-- 4. Atomic RPC function to execute permanent order deletion
-- Unlinks financial records safely (nulling order_id without erasing wallet transactions or payments),
-- deletes dependent fulfillment events and attempts, blocks mid-submission orders, and removes the order.
CREATE OR REPLACE FUNCTION public.admin_delete_order_permanent(
  p_order_id uuid,
  p_admin_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
BEGIN
  -- Verify order exists
  SELECT id, public_order_id, fulfillment_status, payment_status, total, currency
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order not found');
  END IF;

  -- Block deletion if order is mid-submission / actively claimed
  IF v_order.fulfillment_status IN ('SUBMITTING', 'PROCESSING') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Order is currently being submitted or processed by fulfillment. Please try again after it reaches a terminal status.'
    );
  END IF;

  -- 1. Unlink wallet transactions without modifying financial balances
  UPDATE public.wallet_transactions
  SET order_id = NULL
  WHERE order_id = p_order_id;

  -- 2. Unlink payments
  UPDATE public.payments
  SET order_id = NULL
  WHERE order_id = p_order_id;

  -- 3. Unlink customer notes
  UPDATE public.customer_notes
  SET order_id = NULL
  WHERE order_id = p_order_id;

  -- 4. Delete provider order events
  DELETE FROM public.provider_order_events
  WHERE order_id = p_order_id;

  -- 5. Delete provider orders
  DELETE FROM public.provider_orders
  WHERE order_id = p_order_id;

  -- 6. Delete order events
  DELETE FROM public.order_events
  WHERE order_id = p_order_id;

  -- 7. Delete fulfillment attempts if table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'fulfillment_attempts') THEN
    DELETE FROM public.fulfillment_attempts
    WHERE order_id = p_order_id;
  END IF;

  -- 8. Delete order target fixes if table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'order_target_fixes') THEN
    DELETE FROM public.order_target_fixes
    WHERE order_id = p_order_id;
  END IF;

  -- 9. Delete the order
  DELETE FROM public.orders
  WHERE id = p_order_id;

  -- 10. Audit the deletion in admin_action_log
  INSERT INTO public.admin_action_log (
    action,
    performed_by,
    performed_at,
    details
  ) VALUES (
    'ORDER_DELETED_PERMANENTLY',
    p_admin_id,
    now(),
    jsonb_build_object(
      'order_id', v_order.id,
      'public_order_id', v_order.public_order_id,
      'total', v_order.total,
      'currency', v_order.currency,
      'payment_status', v_order.payment_status,
      'fulfillment_status', v_order.fulfillment_status
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'public_order_id', v_order.public_order_id
  );
END;
$$;
