-- Rollback: 20261115000007_provider_balance_monitoring.sql
DELETE FROM public.app_settings
  WHERE key IN (
    'reliablesmm_balance_warning_threshold',
    'reliablesmm_balance_critical_threshold',
    'reliablesmm_service_block_on_critical'
  );

ALTER TABLE public.provider_health
  DROP COLUMN IF EXISTS balance_alert_status,
  DROP COLUMN IF EXISTS consecutive_check_failures;
