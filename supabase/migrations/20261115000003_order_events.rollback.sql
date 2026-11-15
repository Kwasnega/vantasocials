-- Rollback: 20261115000003_order_events.rollback.sql
DROP VIEW IF EXISTS public.customer_order_timeline CASCADE;
DROP TABLE IF EXISTS public.order_events CASCADE;
