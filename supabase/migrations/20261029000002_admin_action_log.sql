-- Migration: 20261029000002_admin_action_log.sql
-- Description: Audit log table for sensitive and destructive admin actions (e.g., data wipe, manual adjustments).

CREATE TABLE IF NOT EXISTS public.admin_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  performed_by uuid NOT NULL REFERENCES auth.users(id),
  performed_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_summary jsonb
);

ALTER TABLE public.admin_action_log ENABLE ROW LEVEL SECURITY;

-- Allow only service_role access (accessed via server-side admin client)
CREATE POLICY "service_role_only" ON public.admin_action_log
  USING (auth.role() = 'service_role');
