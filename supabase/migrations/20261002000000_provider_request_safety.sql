create table if not exists public.provider_request_limits (
  operation_key text primary key,
  owner_token uuid not null,
  next_allowed_at timestamptz not null,
  updated_at timestamptz not null default timezone('utc', now())
);
create index if not exists provider_request_limits_next_allowed_idx on public.provider_request_limits(next_allowed_at);
alter table public.provider_request_limits enable row level security;
revoke all on public.provider_request_limits from public, anon, authenticated;

create or replace function public.acquire_provider_request_slot(p_operation_key text, p_owner_token uuid, p_min_interval_ms integer default 1000)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if p_operation_key is null or length(p_operation_key)>120 or p_min_interval_ms<100 or p_min_interval_ms>60000 then raise exception 'INVALID_PROVIDER_REQUEST_SLOT'; end if;
  insert into public.provider_request_limits(operation_key,owner_token,next_allowed_at)
  values(p_operation_key,p_owner_token,timezone('utc',now())+make_interval(secs=>p_min_interval_ms::numeric/1000))
  on conflict(operation_key) do update set owner_token=excluded.owner_token,next_allowed_at=excluded.next_allowed_at,updated_at=timezone('utc',now())
  where provider_request_limits.next_allowed_at<=timezone('utc',now());
  return found;
end; $$;
revoke all on function public.acquire_provider_request_slot(text,uuid,integer) from public, anon, authenticated;
grant execute on function public.acquire_provider_request_slot(text,uuid,integer) to service_role;

create or replace function public.increment_provider_poll_failure(p_attempt_id uuid,p_owner_token uuid,p_error text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.provider_orders set poll_failure_count=coalesce(poll_failure_count,0)+1,last_poll_error=left(p_error,1000)
  where id=p_attempt_id and reconciliation_owner_token=p_owner_token and reconciliation_lease_expires_at>timezone('utc',now());
  return found;
end; $$;
revoke all on function public.increment_provider_poll_failure(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.increment_provider_poll_failure(uuid,uuid,text) to service_role;

create or replace function public.recover_expired_submission_boundaries()
returns integer language plpgsql security definer set search_path=public as $$
declare recovered integer := 0;
begin
  update public.provider_orders po
  set attempt_status='UNKNOWN_PENDING_RECONCILIATION',
      last_submission_error='Submission worker expired after external-call boundary; provider outcome is unknown.',
      last_submission_error_at=timezone('utc',now()), response_received_at=timezone('utc',now()),
      submission_owner_token=null, submission_lease_expires_at=null, next_submission_at=null,
      manual_review_state='REQUIRED',
      manual_review_reason='Submission boundary crossed but no provider order ID was persisted before lease expiry.',
      manual_review_at=timezone('utc',now())
  where po.attempt_status='PENDING_SUBMISSION'
    and po.submission_lease_expires_at<=timezone('utc',now())
    and po.manual_review_state='NONE'
    and exists(select 1 from public.provider_order_events e where e.provider_order_id=po.id and e.event_type='EXTERNAL_CALL_BOUNDARY_CROSSED');
  get diagnostics recovered=row_count;
  insert into public.provider_order_events(provider_order_id,event_type,previous_attempt_status,new_attempt_status,error_code,metadata)
  select po.id,'SUBMISSION_AMBIGUOUS','PENDING_SUBMISSION','UNKNOWN_PENDING_RECONCILIATION','SUBMISSION_LEASE_EXPIRED',jsonb_build_object('recovery','expired_submission_boundary')
  from public.provider_orders po
  where po.attempt_status='UNKNOWN_PENDING_RECONCILIATION' and po.manual_review_state='REQUIRED'
    and po.last_submission_error='Submission worker expired after external-call boundary; provider outcome is unknown.'
    and not exists(select 1 from public.provider_order_events e where e.provider_order_id=po.id and e.event_type='SUBMISSION_AMBIGUOUS' and e.error_code='SUBMISSION_LEASE_EXPIRED');
  return recovered;
end; $$;
revoke all on function public.recover_expired_submission_boundaries() from public, anon, authenticated;
grant execute on function public.recover_expired_submission_boundaries() to service_role;

create or replace function public.create_safe_provider_retry(p_attempt_id uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare old public.provider_orders; new_id uuid; order_state public.fulfillment_status;
begin
  select po into old from public.provider_orders po join public.orders o on o.id=po.order_id where po.id=p_attempt_id for update;
  if not found then return null; end if;
  select o.fulfillment_status into order_state from public.orders o where o.id=old.order_id for update;
  if not found or old.attempt_status<>'FAILED_BEFORE_SUBMISSION' or old.manual_review_state<>'NONE' or old.attempt_number>=4 or old.submission_retry_count>=3 or order_state<>'SUBMITTING' or (old.next_submission_at is not null and old.next_submission_at>timezone('utc',now())) or (exists(select 1 from public.provider_order_events e where e.provider_order_id=old.id and e.event_type='EXTERNAL_CALL_BOUNDARY_CROSSED') and not exists(select 1 from public.provider_order_events e where e.provider_order_id=old.id and e.event_type='PROVIDER_REJECTED')) then return null; end if;
  insert into public.provider_orders(order_id,attempt_number,provider,provider_service_id,quantity,status,attempt_status,idempotency_key,target_value,provider_cost,currency,raw_response,submission_retry_count)
    values(old.order_id,old.attempt_number+1,old.provider,old.provider_service_id,old.quantity,'NOT_STARTED','PENDING_SUBMISSION',old.idempotency_key||':retry:'||(old.attempt_number+1),old.target_value,old.provider_cost,old.currency,'{}'::jsonb,old.submission_retry_count+1) returning id into new_id;
  insert into public.provider_order_events(provider_order_id,event_type,previous_attempt_status,new_attempt_status,metadata) values(new_id,'RETRY_CREATED','FAILED_BEFORE_SUBMISSION','PENDING_SUBMISSION',jsonb_build_object('previous_attempt_id',old.id,'attempt_number',old.attempt_number+1));
  return new_id;
end; $$;
revoke all on function public.create_safe_provider_retry(uuid) from public, anon, authenticated;
grant execute on function public.create_safe_provider_retry(uuid) to service_role;
