-- 20261115000011_customer_management_and_notes.rollback.sql
-- Rollback for customer_management_and_notes migration

DROP FUNCTION IF EXISTS public.get_customer_financial_summary(uuid);

DROP TABLE IF EXISTS public.customer_status_history;
DROP TABLE IF EXISTS public.customer_notes;

DROP INDEX IF EXISTS public.profiles_account_status_idx;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS account_status,
  DROP COLUMN IF EXISTS account_status_reason,
  DROP COLUMN IF EXISTS status_updated_at,
  DROP COLUMN IF EXISTS status_updated_by;
