-- Migration: 20261115000009_admin_failures_analytics.sql
-- Description: RPC function and supporting indexes for the Admin Order Failures Analytics Dashboard.

-- 1. Targeted performance indexes for failure analytics
CREATE INDEX IF NOT EXISTS orders_service_created_at_idx
  ON public.orders (service_id, created_at DESC);

CREATE INDEX IF NOT EXISTS orders_failure_analytics_idx
  ON public.orders (fulfillment_status, failure_reason, created_at DESC);

-- 2. SQL Server-side Aggregation RPC for Failures Analytics
CREATE OR REPLACE FUNCTION public.get_admin_failure_analytics(
  p_window_hours int DEFAULT 168 -- default 7 days (168h)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start timestamptz;
  v_p24_start timestamptz;
  v_total_orders bigint;
  v_failed_orders bigint;
  v_awaiting_action bigint;
  v_retried_succeeded bigint;
  v_median_resolution_seconds numeric;
  v_by_reason jsonb;
  v_by_platform jsonb;
  v_by_service jsonb;
  v_spikes jsonb;
  v_result jsonb;
BEGIN
  -- Restrict to service_role (called via server-side admin client with requireAdmin)
  IF coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING errcode = '42501';
  END IF;

  v_window_start := timezone('utc', now()) - (p_window_hours || ' hours')::interval;
  v_p24_start := timezone('utc', now()) - interval '24 hours';

  -- 1. Headline summary counts for current window
  SELECT
    count(*),
    count(*) FILTER (WHERE o.fulfillment_status = 'FAILED'),
    count(*) FILTER (
      WHERE o.fulfillment_status = 'FAILED'
        AND (o.target_fix_status = 'AWAITING_CUSTOMER' OR o.failure_reason = 'provider_insufficient_funds')
    )
  INTO
    v_total_orders,
    v_failed_orders,
    v_awaiting_action
  FROM public.orders o
  WHERE o.created_at >= v_window_start;

  -- 2. Retried and then succeeded count & median resolution seconds
  -- Orders in this window that had attempt_count > 1 and ended up COMPLETED
  SELECT
    count(*),
    percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (o.updated_at - o.created_at)))
  INTO
    v_retried_succeeded,
    v_median_resolution_seconds
  FROM public.orders o
  WHERE o.created_at >= v_window_start
    AND o.attempt_count > 1
    AND o.fulfillment_status = 'COMPLETED';

  -- 3. Failures by Reason
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'reason', t.failure_reason,
      'count', t.reason_count,
      'percentage', CASE WHEN v_failed_orders > 0 THEN round((t.reason_count::numeric / v_failed_orders * 100), 1) ELSE 0 END
    ) ORDER BY t.reason_count DESC
  ), '[]'::jsonb)
  INTO v_by_reason
  FROM (
    SELECT
      coalesce(o.failure_reason, 'unknown') AS failure_reason,
      count(*) AS reason_count
    FROM public.orders o
    WHERE o.created_at >= v_window_start
      AND o.fulfillment_status = 'FAILED'
    GROUP BY coalesce(o.failure_reason, 'unknown')
  ) t;

  -- 4. Failures by Platform
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'platform_id', t.platform_id,
      'platform_name', t.platform_name,
      'platform_slug', t.platform_slug,
      'total_orders', t.total_orders,
      'failed_orders', t.failed_orders,
      'failure_rate', CASE WHEN t.total_orders > 0 THEN round((t.failed_orders::numeric / t.total_orders * 100), 1) ELSE 0 END
    ) ORDER BY t.failed_orders DESC, t.total_orders DESC
  ), '[]'::jsonb)
  INTO v_by_platform
  FROM (
    SELECT
      p.id AS platform_id,
      p.name AS platform_name,
      p.slug AS platform_slug,
      count(o.id) AS total_orders,
      count(o.id) FILTER (WHERE o.fulfillment_status = 'FAILED') AS failed_orders
    FROM public.platforms p
    JOIN public.services s ON s.platform_id = p.id
    LEFT JOIN public.orders o ON o.service_id = s.id AND o.created_at >= v_window_start
    GROUP BY p.id, p.name, p.slug
    HAVING count(o.id) > 0
  ) t;

  -- 5. Failures by Service (including provider service id)
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'service_id', t.service_id,
      'service_name', t.service_name,
      'service_slug', t.service_slug,
      'platform_name', t.platform_name,
      'platform_slug', t.platform_slug,
      'provider', t.provider,
      'provider_service_id', t.provider_service_id,
      'total_orders', t.total_orders,
      'failed_orders', t.failed_orders,
      'failure_rate', CASE WHEN t.total_orders > 0 THEN round((t.failed_orders::numeric / t.total_orders * 100), 1) ELSE 0 END,
      'primary_failure_reason', t.primary_failure_reason
    ) ORDER BY (CASE WHEN t.total_orders > 0 THEN (t.failed_orders::numeric / t.total_orders) ELSE 0 END) DESC, t.total_orders DESC
  ), '[]'::jsonb)
  INTO v_by_service
  FROM (
    SELECT
      s.id AS service_id,
      s.name AS service_name,
      s.slug AS service_slug,
      p.name AS platform_name,
      p.slug AS platform_slug,
      s.provider,
      s.provider_service_id,
      count(o.id) AS total_orders,
      count(o.id) FILTER (WHERE o.fulfillment_status = 'FAILED') AS failed_orders,
      (
        SELECT o2.failure_reason
        FROM public.orders o2
        WHERE o2.service_id = s.id
          AND o2.created_at >= v_window_start
          AND o2.fulfillment_status = 'FAILED'
          AND o2.failure_reason IS NOT NULL
        GROUP BY o2.failure_reason
        ORDER BY count(*) DESC
        LIMIT 1
      ) AS primary_failure_reason
    FROM public.services s
    JOIN public.platforms p ON p.id = s.platform_id
    JOIN public.orders o ON o.service_id = s.id AND o.created_at >= v_window_start
    GROUP BY s.id, s.name, s.slug, p.name, p.slug, s.provider, s.provider_service_id
  ) t;

  -- 6. Spikes Detection:
  -- Any service whose last-24h failure rate is > 2x its 7-day rate, AND > 15%, with at least 10 orders in 24h
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'service_id', spk.service_id,
      'service_name', spk.service_name,
      'service_slug', spk.service_slug,
      'platform_name', spk.platform_name,
      'provider', spk.provider,
      'provider_service_id', spk.provider_service_id,
      'rate_24h', spk.rate_24h,
      'rate_7d', spk.rate_7d,
      'orders_24h', spk.orders_24h,
      'failed_24h', spk.failed_24h,
      'primary_reason', spk.primary_reason
    )
  ), '[]'::jsonb)
  INTO v_spikes
  FROM (
    SELECT
      s.id AS service_id,
      s.name AS service_name,
      s.slug AS service_slug,
      p.name AS platform_name,
      s.provider,
      s.provider_service_id,
      count(o24.id) AS orders_24h,
      count(o24.id) FILTER (WHERE o24.fulfillment_status = 'FAILED') AS failed_24h,
      round((count(o24.id) FILTER (WHERE o24.fulfillment_status = 'FAILED')::numeric / NULLIF(count(o24.id), 0) * 100), 1) AS rate_24h,
      round((count(o7d.id) FILTER (WHERE o7d.fulfillment_status = 'FAILED')::numeric / NULLIF(count(o7d.id), 0) * 100), 1) AS rate_7d,
      (
        SELECT o_r.failure_reason
        FROM public.orders o_r
        WHERE o_r.service_id = s.id
          AND o_r.created_at >= v_p24_start
          AND o_r.fulfillment_status = 'FAILED'
        GROUP BY o_r.failure_reason
        ORDER BY count(*) DESC
        LIMIT 1
      ) AS primary_reason
    FROM public.services s
    JOIN public.platforms p ON p.id = s.platform_id
    JOIN public.orders o24 ON o24.service_id = s.id AND o24.created_at >= v_p24_start
    LEFT JOIN public.orders o7d ON o7d.service_id = s.id AND o7d.created_at >= (timezone('utc', now()) - interval '7 days')
    GROUP BY s.id, s.name, s.slug, p.name, s.provider, s.provider_service_id
    HAVING count(o24.id) >= 10
       AND (count(o24.id) FILTER (WHERE o24.fulfillment_status = 'FAILED')::numeric / count(o24.id)) > 0.15
       AND (
         count(o7d.id) FILTER (WHERE o7d.fulfillment_status = 'FAILED') = 0
         OR (
           (count(o24.id) FILTER (WHERE o24.fulfillment_status = 'FAILED')::numeric / count(o24.id)) >
           2 * (count(o7d.id) FILTER (WHERE o7d.fulfillment_status = 'FAILED')::numeric / count(o7d.id))
         )
       )
  ) spk;

  -- 7. Compose final result object
  v_result := jsonb_build_object(
    'window_hours', p_window_hours,
    'total_orders', v_total_orders,
    'failed_orders', v_failed_orders,
    'failure_rate', CASE WHEN v_total_orders > 0 THEN round((v_failed_orders::numeric / v_total_orders * 100), 1) ELSE 0 END,
    'awaiting_action', v_awaiting_action,
    'retried_succeeded', v_retried_succeeded,
    'median_resolution_seconds', v_median_resolution_seconds,
    'by_reason', v_by_reason,
    'by_platform', v_by_platform,
    'by_service', v_by_service,
    'spikes', v_spikes,
    'computed_at', timezone('utc', now())
  );

  RETURN v_result;
END;
$$;
