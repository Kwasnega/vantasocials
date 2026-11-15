-- 20261115000012_manual_wallet_adjustments.rollback.sql
DROP FUNCTION IF EXISTS public.credit_customer_wallet_manual(uuid, uuid, bigint, text, text, text, uuid);
DELETE FROM public.app_settings WHERE key = 'manual_adjustment_max_ghs';
