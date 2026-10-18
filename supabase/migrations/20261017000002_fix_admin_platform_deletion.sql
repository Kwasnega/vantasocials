create or replace function public.delete_admin_platform(p_platform_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  service_count bigint;
  input_field_count bigint;
  input_mapping_count bigint;
  pricing_audit_count bigint;
  provider_audit_count bigint;
begin
  lock table
    public.platforms,
    public.services,
    public.orders,
    public.service_input_fields,
    public.service_provider_input_mappings,
    public.pricing_audit_log,
    public.provider_mapping_audit
  in access exclusive mode;

  if not exists (select 1 from public.platforms where id = p_platform_id) then
    raise exception 'PLATFORM_NOT_FOUND' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.orders o
    join public.services s on s.id = o.service_id
    where s.platform_id = p_platform_id
  ) then
    raise exception 'PLATFORM_HAS_ORDER_HISTORY' using errcode = 'P0001';
  end if;

  select count(*) into service_count
  from public.services
  where platform_id = p_platform_id;

  select count(*) into input_field_count
  from public.service_input_fields f
  join public.services s on s.id = f.service_id
  where s.platform_id = p_platform_id;

  select count(*) into input_mapping_count
  from public.service_provider_input_mappings m
  join public.services s on s.id = m.service_id
  where s.platform_id = p_platform_id;

  select count(*) into pricing_audit_count
  from public.pricing_audit_log a
  join public.services s on s.id = a.service_id
  where s.platform_id = p_platform_id;

  select count(*) into provider_audit_count
  from public.provider_mapping_audit a
  join public.services s on s.id = a.service_id
  where s.platform_id = p_platform_id;

  delete from public.service_provider_input_mappings m
  using public.services s
  where m.service_id = s.id
    and s.platform_id = p_platform_id;

  delete from public.service_input_fields f
  using public.services s
  where f.service_id = s.id
    and s.platform_id = p_platform_id;

  update public.pricing_audit_log a
  set service_id = null
  from public.services s
  where a.service_id = s.id
    and s.platform_id = p_platform_id;

  delete from public.provider_mapping_audit a
  using public.services s
  where a.service_id = s.id
    and s.platform_id = p_platform_id;

  delete from public.services where platform_id = p_platform_id;
  delete from public.platforms where id = p_platform_id;

  return jsonb_build_object(
    'services', service_count,
    'input_fields', input_field_count,
    'input_mappings', input_mapping_count,
    'pricing_audit_entries_detached', pricing_audit_count,
    'provider_mapping_audit_entries_removed', provider_audit_count
  );
end;
$$;

revoke all on function public.delete_admin_platform(uuid) from public, anon, authenticated;
grant execute on function public.delete_admin_platform(uuid) to service_role;
