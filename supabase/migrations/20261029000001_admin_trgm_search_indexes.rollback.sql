-- Rollback: 20261029000001_admin_trgm_search_indexes.rollback.sql
-- Drop indexes created by 20261029000001_admin_trgm_search_indexes.sql

DROP INDEX IF EXISTS public.idx_provider_catalog_service_id_trgm;
DROP INDEX IF EXISTS public.idx_provider_catalog_name_trgm;
DROP INDEX IF EXISTS public.idx_orders_target_value_trgm;
DROP INDEX IF EXISTS public.idx_orders_public_order_id_trgm;
DROP INDEX IF EXISTS public.idx_profiles_email_trgm;

-- Recreate old index if needed
CREATE INDEX IF NOT EXISTS profiles_email_idx
  ON public.profiles (email text_pattern_ops);
