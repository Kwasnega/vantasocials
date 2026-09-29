-- Phase 3 provider catalog control plane. Catalog rows are internal and unpublished by default.
create table if not exists public.provider_catalog_services (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_service_id text not null,
  name text not null,
  provider_rate numeric(24,12) not null check (provider_rate >= 0),
  provider_currency char(3) not null,
  rate_unit text not null check (rate_unit in ('PER_1000','PER_ORDER','UNKNOWN')),
  min_quantity integer not null check (min_quantity > 0),
  max_quantity integer not null check (max_quantity >= min_quantity),
  refill_supported boolean not null default false,
  cancel_supported boolean not null default false,
  provider_status text not null default 'ACTIVE' check (provider_status in ('ACTIVE','STALE','INACTIVE')),
  last_synced_at timestamptz not null default timezone('utc', now()),
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(provider, provider_service_id)
);
create index if not exists provider_catalog_provider_status_idx on public.provider_catalog_services(provider, provider_status);
create index if not exists provider_catalog_service_id_idx on public.provider_catalog_services(provider_service_id);
create index if not exists provider_catalog_name_idx on public.provider_catalog_services using gin (to_tsvector('simple', name));

create table if not exists public.provider_sync_runs (
  id uuid primary key default gen_random_uuid(), provider text not null, started_at timestamptz not null default timezone('utc', now()), completed_at timestamptz,
  status text not null check (status in ('RUNNING','SUCCEEDED','FAILED')), imported_count integer not null default 0, updated_count integer not null default 0,
  failed_count integer not null default 0, error_summary text, triggered_by uuid references auth.users(id)
);
alter table public.provider_catalog_services enable row level security;
alter table public.provider_sync_runs enable row level security;
revoke all on public.provider_catalog_services from anon, authenticated;
revoke all on public.provider_sync_runs from anon, authenticated;
