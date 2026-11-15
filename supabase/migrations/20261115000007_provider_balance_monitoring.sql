-- Migration: 20261115000007_provider_balance_monitoring.sql
-- Description: Extend provider_health with alert status + consecutive failure tracking;
--              seed balance monitoring settings in app_settings.

ALTER TABLE public.provider_health
  ADD COLUMN IF NOT EXISTS balance_alert_status text
    DEFAULT 'UNKNOWN'
    CHECK (balance_alert_status IN ('OK', 'WARNING', 'CRITICAL', 'UNKNOWN')),
  ADD COLUMN IF NOT EXISTS consecutive_check_failures int NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.provider_health.balance_alert_status IS
  'OK/WARNING/CRITICAL/UNKNOWN derived from threshold comparison. UNKNOWN until first successful check.';
COMMENT ON COLUMN public.provider_health.consecutive_check_failures IS
  'Count of consecutive API failures; >=3 consecutive failures forces CRITICAL status conservatively.';

-- Seed balance monitoring settings (do not overwrite if already set)
INSERT INTO public.app_settings (key, value, updated_at)
VALUES
  ('reliablesmm_balance_warning_threshold',  '10.00'::jsonb, timezone('utc', now())),
  ('reliablesmm_balance_critical_threshold', '3.00'::jsonb,  timezone('utc', now())),
  ('reliablesmm_service_block_on_critical',  'false'::jsonb,  timezone('utc', now()))
ON CONFLICT (key) DO NOTHING;
