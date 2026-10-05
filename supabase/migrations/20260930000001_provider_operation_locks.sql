create table if not exists public.provider_operation_locks (
  operation_key text primary key,
  owner_token uuid not null,
  acquired_at timestamptz not null,
  expires_at timestamptz not null
);
create index if not exists provider_operation_locks_expiry_idx on public.provider_operation_locks (expires_at);
alter table public.provider_operation_locks enable row level security;
revoke all on table public.provider_operation_locks from public, anon, authenticated;

create or replace function public.acquire_provider_operation_lock(p_operation_key text, p_owner_token uuid, p_lease_seconds integer default 300)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_operation_key is null or length(p_operation_key) > 120 or p_lease_seconds <= 0 or p_lease_seconds > 3600 then raise exception 'invalid lock request'; end if;
  insert into public.provider_operation_locks(operation_key, owner_token, acquired_at, expires_at)
    values(p_operation_key, p_owner_token, timezone('utc', now()), timezone('utc', now()) + make_interval(secs => p_lease_seconds))
    on conflict (operation_key) do update set owner_token = excluded.owner_token, acquired_at = excluded.acquired_at, expires_at = excluded.expires_at
      where provider_operation_locks.expires_at <= timezone('utc', now());
  return exists(select 1 from public.provider_operation_locks where operation_key = p_operation_key and owner_token = p_owner_token);
end; $$;

create or replace function public.release_provider_operation_lock(p_operation_key text, p_owner_token uuid)
returns boolean language sql security definer set search_path = public as $$
  delete from public.provider_operation_locks where operation_key = p_operation_key and owner_token = p_owner_token returning true;
$$;

revoke all on function public.acquire_provider_operation_lock(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_provider_operation_lock(text, uuid) from public, anon, authenticated;
grant execute on function public.acquire_provider_operation_lock(text, uuid, integer) to service_role;
grant execute on function public.release_provider_operation_lock(text, uuid) to service_role;
