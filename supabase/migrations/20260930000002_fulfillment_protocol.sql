create table if not exists public.fulfillment_order_claims (
  order_id uuid primary key references public.orders(id) on delete restrict,
  owner_token uuid not null,
  acquired_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  released_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create index if not exists fulfillment_order_claims_expiry_idx on public.fulfillment_order_claims(expires_at);
alter table public.fulfillment_order_claims enable row level security;
revoke all on public.fulfillment_order_claims from public, anon, authenticated;

alter table public.provider_orders
  add column if not exists submission_owner_token uuid,
  add column if not exists submission_lease_expires_at timestamptz,
  add column if not exists submission_takeover_count integer not null default 0,
  add column if not exists submission_retry_count integer not null default 0,
  add column if not exists next_submission_at timestamptz,
  add column if not exists last_submission_error text,
  add column if not exists last_submission_error_at timestamptz,
  add column if not exists reconciliation_owner_token uuid,
  add column if not exists reconciliation_lease_expires_at timestamptz,
  add column if not exists reconciliation_takeover_count integer not null default 0,
  add column if not exists poll_failure_count integer not null default 0,
  add column if not exists last_poll_error text,
  add column if not exists manual_review_state text not null default 'NONE',
  add column if not exists manual_review_reason text,
  add column if not exists manual_review_at timestamptz,
  add column if not exists manual_reviewed_by uuid references auth.users(id),
  add column if not exists manual_resolution text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='provider_orders_manual_review_state_check' and conrelid='public.provider_orders'::regclass) then
    alter table public.provider_orders add constraint provider_orders_manual_review_state_check check (manual_review_state in ('NONE','REQUIRED','RESOLVED'));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='provider_orders_manual_review_consistency' and conrelid='public.provider_orders'::regclass) then
    alter table public.provider_orders add constraint provider_orders_manual_review_consistency check (
      (manual_review_state='NONE' and manual_review_reason is null and manual_review_at is null and manual_reviewed_by is null and manual_resolution is null)
      or (manual_review_state='REQUIRED' and nullif(trim(manual_review_reason),'') is not null and manual_review_at is not null)
      or (manual_review_state='RESOLVED' and nullif(trim(manual_review_reason),'') is not null and manual_review_at is not null and manual_reviewed_by is not null and nullif(trim(manual_resolution),'') is not null)
    );
  end if;
end $$;

create table if not exists public.provider_order_events (
 id uuid primary key default gen_random_uuid(),
 provider_order_id uuid references public.provider_orders(id) on delete restrict,
 order_id uuid references public.orders(id) on delete restrict,
 event_type text not null,
 previous_attempt_status text,
 new_attempt_status text,
 provider_status text,
 error_code varchar(1000),
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default timezone('utc', now()),
 constraint provider_order_events_metadata_size check (pg_column_size(metadata) <= 8192),
 constraint provider_order_events_subject_check check (provider_order_id is not null or order_id is not null)
);
create index if not exists provider_order_events_attempt_created_idx on public.provider_order_events(provider_order_id, created_at);
alter table public.provider_order_events enable row level security;
revoke all on public.provider_order_events from public, anon, authenticated;
create or replace function public.prevent_provider_order_event_mutation() returns trigger language plpgsql security definer set search_path=public as $$ begin raise exception 'PROVIDER_ORDER_EVENTS_IMMUTABLE'; end; $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname='provider_order_events_immutable' and tgrelid='public.provider_order_events'::regclass) then
    create trigger provider_order_events_immutable before update or delete on public.provider_order_events for each row execute function public.prevent_provider_order_event_mutation();
  end if;
end $$;

create or replace function public.claim_fulfillment_order(p_order_id uuid, p_owner_token uuid, p_lease_seconds integer default 600)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if p_lease_seconds < 1 or p_lease_seconds > 600 then raise exception 'INVALID_LEASE'; end if;
  insert into public.fulfillment_order_claims(order_id,owner_token,expires_at)
  select p_order_id,p_owner_token,timezone('utc',now()) + make_interval(secs=>p_lease_seconds)
  from public.orders o where o.id=p_order_id and o.payment_status='PAID' and ((o.fulfillment_status='NOT_STARTED' and not exists(select 1 from public.provider_orders po where po.order_id=o.id and po.attempt_status in ('PENDING_SUBMISSION','SUBMITTED','UNKNOWN_PENDING_RECONCILIATION'))) or (o.fulfillment_status='SUBMITTING' and exists(select 1 from public.provider_orders po where po.order_id=o.id and po.attempt_status='FAILED_BEFORE_SUBMISSION' and (po.next_submission_at is null or po.next_submission_at<=timezone('utc',now())) and po.manual_review_state='NONE' and po.id=(select p2.id from public.provider_orders p2 where p2.order_id=o.id order by p2.attempt_number desc limit 1)) and not exists(select 1 from public.provider_orders po where po.order_id=o.id and po.attempt_status in ('PENDING_SUBMISSION','SUBMITTED','UNKNOWN_PENDING_RECONCILIATION'))))
  on conflict(order_id) do update set owner_token=excluded.owner_token, acquired_at=timezone('utc',now()), expires_at=excluded.expires_at, released_at=null, updated_at=timezone('utc',now())
  where public.fulfillment_order_claims.released_at is not null or public.fulfillment_order_claims.expires_at <= timezone('utc',now());
  return found;
end; $$;

create or replace function public.require_provider_manual_review(p_attempt_id uuid,p_reason text) returns boolean language plpgsql security definer set search_path=public as $$ begin update public.provider_orders set manual_review_state='REQUIRED',manual_review_reason=left(nullif(trim(p_reason),''),1000),manual_review_at=timezone('utc',now()) where id=p_attempt_id and manual_review_state='NONE' and nullif(trim(p_reason),'') is not null; if not found then return false; end if; insert into public.provider_order_events(provider_order_id,event_type,error_code) values(p_attempt_id,'MANUAL_REVIEW_REQUIRED',left(trim(p_reason),1000)); return true; end; $$;
create or replace function public.resolve_provider_manual_review(p_attempt_id uuid,p_reviewer uuid,p_reason text,p_resolution text) returns boolean language plpgsql security definer set search_path=public as $$ begin update public.provider_orders set manual_review_state='RESOLVED',manual_review_reason=left(nullif(trim(p_reason),''),1000),manual_review_at=coalesce(manual_review_at,timezone('utc',now())),manual_reviewed_by=p_reviewer,manual_resolution=left(nullif(trim(p_resolution),''),1000) where id=p_attempt_id and manual_review_state='REQUIRED' and nullif(trim(p_reason),'') is not null and nullif(trim(p_resolution),'') is not null; if not found then return false; end if; insert into public.provider_order_events(provider_order_id,event_type,error_code,metadata) values(p_attempt_id,'MANUAL_REVIEW_RESOLVED',left(trim(p_reason),1000),jsonb_build_object('resolution',left(trim(p_resolution),1000))); return true; end; $$;
create or replace function public.create_safe_provider_retry(p_attempt_id uuid) returns uuid language plpgsql security definer set search_path=public as $$ declare old public.provider_orders; new_id uuid; order_state public.fulfillment_status; begin select po into old from public.provider_orders po join public.orders o on o.id=po.order_id where po.id=p_attempt_id for update; if not found then return null; end if; select o.fulfillment_status into order_state from public.orders o where o.id=old.order_id for update; if not found or old.attempt_status<>'FAILED_BEFORE_SUBMISSION' or old.manual_review_state<>'NONE' or old.attempt_number>=4 or old.submission_retry_count>=3 or order_state<>'SUBMITTING' or (old.next_submission_at is not null and old.next_submission_at>timezone('utc',now())) or exists(select 1 from public.provider_order_events e where e.provider_order_id=old.id and e.event_type='EXTERNAL_CALL_BOUNDARY_CROSSED') then return null; end if; insert into public.provider_orders(order_id,attempt_number,provider,provider_service_id,quantity,status,attempt_status,idempotency_key,target_value,provider_cost,currency,raw_response,submission_retry_count) values(old.order_id,old.attempt_number+1,old.provider,old.provider_service_id,old.quantity,'NOT_STARTED','PENDING_SUBMISSION',old.idempotency_key||':retry:'||(old.attempt_number+1),old.target_value,old.provider_cost,old.currency,'{}'::jsonb,old.submission_retry_count+1) returning id into new_id; insert into public.provider_order_events(provider_order_id,event_type,previous_attempt_status,new_attempt_status,metadata) values(new_id,'RETRY_CREATED','FAILED_BEFORE_SUBMISSION','PENDING_SUBMISSION',jsonb_build_object('previous_attempt_id',old.id,'attempt_number',old.attempt_number+1)); return new_id; end; $$;

create or replace function public.renew_fulfillment_order_claim(p_order_id uuid,p_owner_token uuid,p_lease_seconds integer default 600)
returns boolean language plpgsql security definer set search_path=public as $$ begin update public.fulfillment_order_claims set expires_at=timezone('utc',now())+make_interval(secs=>p_lease_seconds),updated_at=timezone('utc',now()) where order_id=p_order_id and owner_token=p_owner_token and released_at is null and expires_at>timezone('utc',now()); return found; end; $$;
create or replace function public.release_fulfillment_order_claim(p_order_id uuid,p_owner_token uuid)
returns boolean language plpgsql security definer set search_path=public as $$ begin update public.fulfillment_order_claims set released_at=timezone('utc',now()),updated_at=timezone('utc',now()) where order_id=p_order_id and owner_token=p_owner_token and released_at is null; return found; end; $$;

create or replace function public.acquire_submission_lease(p_attempt_id uuid,p_owner_token uuid,p_lease_seconds integer default 60)
returns boolean language plpgsql security definer set search_path=public as $$ begin update public.provider_orders set submission_owner_token=p_owner_token,submission_lease_expires_at=timezone('utc',now())+make_interval(secs=>p_lease_seconds),submission_takeover_count=submission_takeover_count+case when submission_owner_token is not null then 1 else 0 end where id=p_attempt_id and attempt_status='PENDING_SUBMISSION' and (submission_owner_token is null or submission_lease_expires_at<=timezone('utc',now())); return found; end; $$;
create or replace function public.acquire_reconciliation_lease(p_attempt_id uuid,p_owner_token uuid,p_lease_seconds integer default 120)
returns boolean language plpgsql security definer set search_path=public as $$ begin update public.provider_orders set reconciliation_owner_token=p_owner_token,reconciliation_lease_expires_at=timezone('utc',now())+make_interval(secs=>p_lease_seconds),reconciliation_takeover_count=reconciliation_takeover_count+case when reconciliation_owner_token is not null then 1 else 0 end where id=p_attempt_id and provider_order_id is not null and attempt_status in ('SUBMITTED','UNKNOWN_PENDING_RECONCILIATION') and manual_review_state='NONE' and (reconciliation_owner_token is null or reconciliation_lease_expires_at<=timezone('utc',now())); return found; end; $$;
create or replace function public.release_reconciliation_lease(p_attempt_id uuid,p_owner_token uuid) returns boolean language plpgsql security definer set search_path=public as $$ begin update public.provider_orders set reconciliation_owner_token=null,reconciliation_lease_expires_at=null where id=p_attempt_id and reconciliation_owner_token=p_owner_token; return found; end; $$;

create or replace function public.cleanup_provider_order_events(p_before timestamptz default timezone('utc',now())) returns integer language plpgsql security definer set search_path=public as $$ declare n integer; begin delete from public.provider_order_events e where e.id in (select candidate.id from public.provider_order_events candidate left join public.provider_orders po on po.id=candidate.provider_order_id where candidate.created_at<p_before and (candidate.provider_order_id is null or po.manual_review_state is null or po.manual_review_state not in ('REQUIRED','RESOLVED')) order by candidate.created_at,candidate.id limit 500); get diagnostics n=row_count; return n; end; $$;
create or replace function public.record_submission_boundary(p_attempt_id uuid,p_owner_token uuid) returns boolean language plpgsql security definer set search_path=public as $$ begin
  if not exists(select 1 from public.provider_orders where id=p_attempt_id and submission_owner_token=p_owner_token and submission_lease_expires_at>timezone('utc',now()) and attempt_status='PENDING_SUBMISSION') then return false; end if;
  insert into public.provider_order_events(provider_order_id,event_type,previous_attempt_status,new_attempt_status,metadata) values(p_attempt_id,'SUBMISSION_STARTED','PENDING_SUBMISSION','PENDING_SUBMISSION','{}'::jsonb),(p_attempt_id,'EXTERNAL_CALL_BOUNDARY_CROSSED','PENDING_SUBMISSION','PENDING_SUBMISSION','{}'::jsonb);
  return true;
end; $$;
create or replace function public.persist_provider_submission_success(p_attempt_id uuid,p_owner_token uuid,p_provider_order_id text,p_status public.fulfillment_status,p_raw_response jsonb) returns boolean language plpgsql security definer set search_path=public as $$ begin
  update public.provider_orders set provider_order_id=p_provider_order_id,status=p_status,attempt_status='SUBMITTED',raw_response=coalesce(p_raw_response,'{}'::jsonb),response_received_at=timezone('utc',now()),submission_owner_token=null,submission_lease_expires_at=null where id=p_attempt_id and submission_owner_token=p_owner_token and submission_lease_expires_at>timezone('utc',now()) and attempt_status='PENDING_SUBMISSION';
  if not found then return false; end if;
  insert into public.provider_order_events(provider_order_id,event_type,previous_attempt_status,new_attempt_status,metadata) values(p_attempt_id,'PROVIDER_ACCEPTED','PENDING_SUBMISSION','SUBMITTED',jsonb_build_object('provider_order_id',p_provider_order_id)); return true;
end; $$;
create or replace function public.record_submission_failure(p_attempt_id uuid,p_owner_token uuid,p_ambiguous boolean,p_error text) returns boolean language plpgsql security definer set search_path=public as $$ declare s text; n integer; oid uuid; begin select attempt_number,order_id into n,oid from public.provider_orders where id=p_attempt_id and submission_owner_token=p_owner_token and submission_lease_expires_at>timezone('utc',now()) and attempt_status='PENDING_SUBMISSION' for update; if not found then return false; end if; s:=case when p_ambiguous then 'UNKNOWN_PENDING_RECONCILIATION' else 'FAILED_BEFORE_SUBMISSION' end; update public.provider_orders set attempt_status=s,last_submission_error=left(p_error,1000),last_submission_error_at=timezone('utc',now()),response_received_at=timezone('utc',now()),submission_owner_token=null,submission_lease_expires_at=null,next_submission_at=case when p_ambiguous or n>=4 then null else timezone('utc',now())+make_interval(secs=>case n when 1 then 60 when 2 then 300 when 3 then 900 end) end where id=p_attempt_id; insert into public.provider_order_events(provider_order_id,event_type,previous_attempt_status,new_attempt_status,error_code) values(p_attempt_id,case when p_ambiguous then 'SUBMISSION_AMBIGUOUS' when n>=4 then 'RETRY_EXHAUSTED' else 'PROVIDER_REJECTED' end,'PENDING_SUBMISSION',s,left(p_error,1000)); if not p_ambiguous and n>=4 then if not public.transition_fulfillment_state(oid,'SUBMITTING','FAILED') then raise exception 'FULFILLMENT_STATE_CONFLICT'; end if; end if; return true; end; $$;
create or replace function public.transition_fulfillment_state(p_order_id uuid,p_from public.fulfillment_status,p_to public.fulfillment_status) returns boolean language plpgsql security definer set search_path=public as $$ begin
 if not ((p_from='NOT_STARTED' and p_to='SUBMITTING') or (p_from='SUBMITTING' and p_to in ('SUBMITTED','FAILED')) or (p_from='SUBMITTED' and p_to in ('PROCESSING','FAILED','CANCELLED')) or (p_from='PROCESSING' and p_to in ('COMPLETED','PARTIAL','FAILED','CANCELLED'))) then return false; end if;
 update public.orders set fulfillment_status=p_to where id=p_order_id and fulfillment_status=p_from; if not found then return false; end if; insert into public.provider_order_events(order_id,event_type,metadata) values(p_order_id,'CUSTOMER_FULFILLMENT_TRANSITION',jsonb_build_object('from',p_from,'to',p_to)); return true; end; $$;

do $$ declare f text; begin foreach f in array ARRAY['claim_fulfillment_order(uuid,uuid,integer)','renew_fulfillment_order_claim(uuid,uuid,integer)','release_fulfillment_order_claim(uuid,uuid)','acquire_submission_lease(uuid,uuid,integer)','acquire_reconciliation_lease(uuid,uuid,integer)','release_reconciliation_lease(uuid,uuid)','cleanup_provider_order_events(timestamptz)','record_submission_boundary(uuid,uuid)','persist_provider_submission_success(uuid,uuid,text,public.fulfillment_status,jsonb)','record_submission_failure(uuid,uuid,boolean,text)','transition_fulfillment_state(uuid,public.fulfillment_status,public.fulfillment_status)','require_provider_manual_review(uuid,text)','resolve_provider_manual_review(uuid,uuid,text,text)','create_safe_provider_retry(uuid)'] loop execute format('revoke all on function public.%s from public,anon,authenticated',f); execute format('grant execute on function public.%s to service_role',f); end loop; end $$;
