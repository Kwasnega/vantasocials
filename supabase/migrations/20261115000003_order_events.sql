-- Migration: 20261115000003_order_events.sql
-- Description: Create order_events table, index, RLS policies, and customer filtered view

CREATE TABLE IF NOT EXISTS public.order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  type text NOT NULL,
  status_before text,
  status_after text,
  message text,
  meta jsonb DEFAULT '{}'::jsonb,
  actor text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- Index for timeline queries
CREATE INDEX IF NOT EXISTS order_events_order_id_created_at_idx
  ON public.order_events (order_id, created_at ASC);

-- Enable RLS
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;

-- Revoke default public permissions
REVOKE ALL ON public.order_events FROM anon, authenticated;

-- Service role full access
CREATE POLICY "order_events_service_role"
  ON public.order_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated customers can read ONLY their own order events, and only safe types/fields
CREATE POLICY "order_events_customer_select"
  ON public.order_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_events.order_id
        AND o.user_id = auth.uid()
    )
    AND type NOT IN ('admin_note', 'internal_error', 'raw_provider_debug')
  );

-- Create a secure view for customer timeline that strips admin notes and raw meta
CREATE OR REPLACE VIEW public.customer_order_timeline AS
SELECT
  oe.id,
  oe.order_id,
  oe.type,
  oe.status_before,
  oe.status_after,
  oe.message,
  oe.created_at
FROM public.order_events oe
JOIN public.orders o ON o.id = oe.order_id
WHERE o.user_id = auth.uid()
  AND oe.type NOT IN ('admin_note', 'internal_error', 'raw_provider_debug');

ALTER VIEW public.customer_order_timeline OWNER TO postgres;
GRANT SELECT ON public.customer_order_timeline TO authenticated;
