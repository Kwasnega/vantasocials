-- Rollback: 20261028000001_admin_performance_indexes.rollback.sql
-- Drop indexes and function created by 20261028000001_admin_performance_indexes.sql

DROP INDEX IF EXISTS public.provider_order_events_order_id_idx;
DROP INDEX IF EXISTS public.provider_orders_status_poll_idx;
DROP INDEX IF EXISTS public.profiles_email_idx;
DROP INDEX IF EXISTS public.orders_created_at_id_desc_idx;
DROP INDEX IF EXISTS public.orders_fulfillment_status_created_idx;
DROP INDEX IF EXISTS public.orders_payment_status_created_idx;

DROP FUNCTION IF EXISTS public.get_admin_dashboard_metrics();
