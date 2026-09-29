alter table public.webhook_events
  add column if not exists processing boolean not null default false,
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_token uuid,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_error text;

create or replace function public.claim_paystack_webhook_event(p_event_id text, p_event_type text, p_payload jsonb)
returns table (event_id text, claimed boolean, already_processed boolean, processing_token uuid)
language plpgsql security definer set search_path = public
as $$
declare v_event public.webhook_events; v_token uuid;
begin
  if p_event_id is null or length(trim(p_event_id)) = 0 then raise exception 'INVALID_EVENT_ID' using errcode='22023'; end if;
  insert into public.webhook_events(provider,event_id,event_type,payload)
  values ('paystack',p_event_id,coalesce(nullif(trim(p_event_type),''),'unknown'),coalesce(p_payload,'{}'::jsonb))
  on conflict (provider,event_id) do nothing;
  select * into v_event from public.webhook_events where provider='paystack' and event_id=p_event_id for update;
  if v_event.processed then return query select p_event_id,false,true,null::uuid; return; end if;
  if v_event.processing and v_event.processing_started_at is not null and v_event.processing_started_at > timezone('utc',now())-interval '5 minutes' then
    return query select p_event_id,false,false,null::uuid; return;
  end if;
  v_token := gen_random_uuid();
  update public.webhook_events set processing=true, processing_started_at=timezone('utc',now()), processing_token=v_token, attempt_count=attempt_count+1, last_error=null where provider='paystack' and event_id=p_event_id;
  return query select p_event_id,true,false,v_token;
end;
$$;

create or replace function public.complete_paystack_webhook_event(p_event_id text, p_processing_token uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  update public.webhook_events set processed=true, processing=false, processed_at=timezone('utc',now()), processing_started_at=null, processing_token=null, last_error=null
  where provider='paystack' and event_id=p_event_id and processed=false and processing=true and processing_token=p_processing_token;
  return found;
end;
$$;

create or replace function public.fail_paystack_webhook_event(p_event_id text, p_processing_token uuid, p_error text)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  update public.webhook_events set processing=false, processing_started_at=null, processing_token=null, last_error=left(coalesce(p_error,'Webhook processing failed.'),1000)
  where provider='paystack' and event_id=p_event_id and processed=false and processing=true and processing_token=p_processing_token;
  return found;
end;
$$;

revoke all on function public.claim_paystack_webhook_event(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.complete_paystack_webhook_event(text,uuid) from public,anon,authenticated;
revoke all on function public.fail_paystack_webhook_event(text,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_paystack_webhook_event(text,text,jsonb) to service_role;
grant execute on function public.complete_paystack_webhook_event(text,uuid) to service_role;
grant execute on function public.fail_paystack_webhook_event(text,uuid,text) to service_role;
