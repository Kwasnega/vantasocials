-- Migration: 20261029000001_admin_trgm_search_indexes.sql
-- Description: GIN trigram indexes for admin ILIKE contains-search on email, order IDs, and catalog names.
-- Safe for execution in the Supabase SQL Editor and migration runners.

-- Step 1: Enable pg_trgm extension in the extensions schema (Supabase standard) or public fallback
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- Step 2: Drop old text_pattern_ops email index (replaced by trgm GIN which supports both prefix and contains)
DROP INDEX IF EXISTS public.profiles_email_idx;

-- Step 3: Create trgm GIN indexes using explicit operator class reference
-- If pg_trgm is in extensions schema or public schema, gin_trgm_ops resolves directly
CREATE INDEX IF NOT EXISTS idx_profiles_email_trgm
  ON public.profiles USING GIN (email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_orders_public_order_id_trgm
  ON public.orders USING GIN (public_order_id gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_orders_target_value_trgm
  ON public.orders USING GIN (target_value gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_provider_catalog_name_trgm
  ON public.provider_catalog_services USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_provider_catalog_service_id_trgm
  ON public.provider_catalog_services USING GIN (provider_service_id gin_trgm_ops);
