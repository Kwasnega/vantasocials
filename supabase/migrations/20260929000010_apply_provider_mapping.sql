create or replace function public.apply_provider_mapping(
  p_service_id uuid,
  p_provider text,
  p_provider_service_id text,
  p_changed_by uuid
)
returns table (
  service_id uuid,
  provider text,
  provider_service_id text,
  provider_rate numeric,
  provider_rate_unit text,
  provider_currency char(3),
  previous_provider text,
  previous_provider_service_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous_provider text;
  v_previous_provider_service_id text;
  v_catalog public.provider_catalog_services%rowtype;
begin
  if p_provider <> 'reliablesmm' then
    raise exception 'Unsupported provider';
  end if;

  if p_provider_service_id !~ '^[0-9]+$' then
    raise exception 'Invalid provider service ID';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = p_changed_by
      and is_admin = true
  ) then
    raise exception 'Admin authorization required';
  end if;

  select s.provider, s.provider_service_id
    into v_previous_provider, v_previous_provider_service_id
    from public.services s
   where s.id = p_service_id
   for update;

  if not found then
    raise exception 'VANTA service not found';
  end if;

  select *
    into v_catalog
    from public.provider_catalog_services pcs
   where pcs.provider = p_provider
     and pcs.provider_service_id = p_provider_service_id
     and pcs.provider_status = 'ACTIVE'
   for update;

  if not found then
    raise exception 'Active provider catalog service not found';
  end if;

  update public.services
     set provider = v_catalog.provider,
         provider_service_id = v_catalog.provider_service_id,
         provider_rate = v_catalog.provider_rate,
         provider_rate_unit = v_catalog.rate_unit,
         provider_currency = v_catalog.provider_currency,
         provider_rate_last_synced = timezone('utc', now()),
         provider_rate_source = 'RELIABLESMM_CATALOG'
   where id = p_service_id;

  insert into public.provider_mapping_audit (
    service_id, changed_by, previous_provider, previous_provider_service_id,
    new_provider, new_provider_service_id, metadata
  )
  values (
    p_service_id, p_changed_by, v_previous_provider, v_previous_provider_service_id,
    v_catalog.provider, v_catalog.provider_service_id,
    jsonb_build_object('provider_service_name', v_catalog.name)
  );

  return query
  select p_service_id, v_catalog.provider, v_catalog.provider_service_id,
         v_catalog.provider_rate, v_catalog.rate_unit, v_catalog.provider_currency,
         v_previous_provider, v_previous_provider_service_id;
end;
$$;

revoke all on function public.apply_provider_mapping(uuid, text, text, uuid) from public;
revoke all on function public.apply_provider_mapping(uuid, text, text, uuid) from anon;
revoke all on function public.apply_provider_mapping(uuid, text, text, uuid) from authenticated;
grant execute on function public.apply_provider_mapping(uuid, text, text, uuid) to service_role;
