create table if not exists public.rate_limit_buckets (
  bucket_key text not null,
  window_seconds integer not null check (window_seconds > 0 and window_seconds <= 86400),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  expires_at timestamptz not null,
  primary key (bucket_key, window_seconds, window_started_at)
);
create index if not exists rate_limit_buckets_expires_idx on public.rate_limit_buckets (expires_at);
alter table public.rate_limit_buckets enable row level security;
revoke all on table public.rate_limit_buckets from public, anon, authenticated;

create or replace function public.consume_rate_limits(p_requests jsonb)
returns table(allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql security definer set search_path = public
as $$
declare r jsonb; k text; lim integer; win integer; started timestamptz; n integer; min_remaining integer := 2147483647; max_retry integer := 1; ok boolean := true;
begin
  if jsonb_typeof(p_requests) <> 'array' then raise exception 'invalid rate limit request'; end if;
  for r in select * from jsonb_array_elements(p_requests) loop
    k := r->>'key'; lim := (r->>'limit')::integer; win := (r->>'windowSeconds')::integer;
    if k is null or length(k) > 300 or lim <= 0 or win <= 0 then raise exception 'invalid rate limit rule'; end if;
    started := to_timestamp(floor(extract(epoch from timezone('utc', now())) / win) * win);
    insert into public.rate_limit_buckets(bucket_key, window_seconds, window_started_at, request_count, expires_at)
      values(k, win, started, 1, started + make_interval(secs => win))
      on conflict (bucket_key, window_seconds, window_started_at) do update
        set request_count = rate_limit_buckets.request_count + 1;
    select request_count into n from public.rate_limit_buckets where bucket_key=k and window_seconds=win and window_started_at=started;
    if n > lim then ok := false; end if;
    min_remaining := least(min_remaining, greatest(0, lim - n));
    max_retry := greatest(max_retry, ceil(extract(epoch from (started + make_interval(secs => win) - timezone('utc', now()))))::integer);
  end loop;
  return query select ok, greatest(0, min_remaining), greatest(1, max_retry);
end; $$;
revoke all on function public.consume_rate_limits(jsonb) from public, anon, authenticated;
grant execute on function public.consume_rate_limits(jsonb) to service_role;

create or replace function public.cleanup_rate_limit_buckets(p_before timestamptz default timezone('utc', now()))
returns integer language sql security definer set search_path = public as $$
  with candidates as (select ctid from public.rate_limit_buckets where expires_at < p_before order by expires_at limit 500),
  deleted as (delete from public.rate_limit_buckets b using candidates c where b.ctid = c.ctid returning 1)
  select count(*)::integer from deleted;
$$;
revoke all on function public.cleanup_rate_limit_buckets(timestamptz) from public, anon, authenticated;
grant execute on function public.cleanup_rate_limit_buckets(timestamptz) to service_role;
