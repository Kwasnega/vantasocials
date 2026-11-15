-- Migration Rollback: 20261115000001_app_settings.rollback.sql
-- Description: Drop app_settings and app_settings_audit tables

DROP TABLE IF EXISTS public.app_settings_audit CASCADE;
DROP TABLE IF EXISTS public.app_settings CASCADE;
