-- Rollback: 20261115000009_admin_failures_analytics.sql
DROP FUNCTION IF EXISTS public.get_admin_failure_analytics(int);

DROP INDEX IF EXISTS public.orders_failure_analytics_idx;
DROP INDEX IF EXISTS public.orders_service_created_at_idx;
