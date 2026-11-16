-- Migration: Fix claim_paystack_webhook_event ambiguous column reference (Postgres error 42702)
--
-- ROOT CAUSE: The function declares `returns table (event_id text, ...)`.
-- Inside the function body, bare `event_id` is ambiguous between:
--   (a) the output column named event_id  (the RETURNS TABLE column)
--   (b) the webhook_events.event_id column in the WHERE clause
-- Postgres 42702 fires on the WHERE clause in UPDATE and SELECT … WHERE event_id = p_event_id
-- because Postgres cannot tell which `event_id` you mean when both a table column
-- and an output column share the same name.
--
-- FIX: Prefix every table column reference with the alias `we.`, and rename
-- the output column in RETURNS TABLE from event_id to out_event_id so there
-- is zero ambiguity. The route already reads claim?.claimed and
-- claim?.processing_token — it does NOT read claim?.event_id — so renaming
-- the output column is safe.

-- Drop first because we are changing the RETURNS TABLE column name (out_event_id vs event_id).
-- Postgres refuses CREATE OR REPLACE when the output row type changes.
-- The function is security definer / service_role only; no callers outside this codebase.
drop function if exists public.claim_paystack_webhook_event(text, text, jsonb);

create or replace function public.claim_paystack_webhook_event(
  p_event_id    text,
  p_event_type  text,
  p_payload     jsonb
)
returns table (
  out_event_id       text,
  claimed            boolean,
  already_processed  boolean,
  processing_token   uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event  public.webhook_events;
  v_token  uuid;
begin
  if p_event_id is null or length(trim(p_event_id)) = 0 then
    raise exception 'INVALID_EVENT_ID' using errcode = '22023';
  end if;

  -- Insert new event (idempotent: ignore conflict on unique(provider, event_id))
  insert into public.webhook_events (provider, event_id, event_type, payload)
  values (
    'paystack',
    p_event_id,
    coalesce(nullif(trim(p_event_type), ''), 'unknown'),
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (provider, event_id) do nothing;

  -- Lock the row for this invocation
  select we.*
    into v_event
    from public.webhook_events we
   where we.provider  = 'paystack'
     and we.event_id  = p_event_id
   for update;

  -- Already fully processed → deduplicate, do not re-process
  if v_event.processed then
    return query select p_event_id, false, true, null::uuid;
    return;
  end if;

  -- Another invocation is mid-flight and started within the last 5 minutes → skip
  if v_event.processing
     and v_event.processing_started_at is not null
     and v_event.processing_started_at > timezone('utc', now()) - interval '5 minutes'
  then
    return query select p_event_id, false, false, null::uuid;
    return;
  end if;

  -- Claim the row for this invocation
  v_token := gen_random_uuid();
  update public.webhook_events we2
     set processing             = true,
         processing_started_at  = timezone('utc', now()),
         processing_token       = v_token,
         attempt_count          = we2.attempt_count + 1,
         last_error             = null
   where we2.provider  = 'paystack'
     and we2.event_id  = p_event_id;

  return query select p_event_id, true, false, v_token;
end;
$$;

-- Keep grants identical to original
revoke all on function public.claim_paystack_webhook_event(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_paystack_webhook_event(text, text, jsonb)
  to service_role;
