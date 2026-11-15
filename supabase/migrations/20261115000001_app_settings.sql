-- Migration: 20261115000001_app_settings.sql
-- Description: Create app_settings and app_settings_audit tables with RLS and seed min_deposit_ghs

CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_by uuid REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.app_settings_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  old_value jsonb,
  new_value jsonb NOT NULL,
  changed_by uuid REFERENCES auth.users(id),
  changed_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS app_settings_audit_key_idx ON public.app_settings_audit(key, changed_at DESC);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings_audit ENABLE ROW LEVEL SECURITY;

-- Allow only service_role access (accessed via server-side admin client with requireAdmin())
REVOKE ALL ON public.app_settings FROM anon, authenticated;
REVOKE ALL ON public.app_settings_audit FROM anon, authenticated;

CREATE POLICY "app_settings_service_role" ON public.app_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "app_settings_audit_service_role" ON public.app_settings_audit
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Seed min_deposit_ghs default if not present
INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('min_deposit_ghs', '35.00'::jsonb, timezone('utc', now()))
ON CONFLICT (key) DO NOTHING;
