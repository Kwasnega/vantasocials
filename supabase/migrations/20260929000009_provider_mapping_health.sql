create table if not exists public.provider_mapping_audit (
 id uuid primary key default gen_random_uuid(), service_id uuid not null references public.services(id) on delete restrict,
 changed_by uuid references auth.users(id), previous_provider text, previous_provider_service_id text, new_provider text, new_provider_service_id text,
 metadata jsonb not null default '{}'::jsonb, changed_at timestamptz not null default timezone('utc', now())
);
create index if not exists provider_mapping_audit_service_idx on public.provider_mapping_audit(service_id, changed_at desc);
create table if not exists public.provider_health (
 provider text primary key, configured boolean not null default false, balance text, balance_currency char(3), last_balance_check timestamptz,
 balance_status text, last_catalog_sync timestamptz, catalog_count integer not null default 0, last_error text, updated_at timestamptz not null default timezone('utc', now())
);
alter table public.provider_mapping_audit enable row level security;
alter table public.provider_health enable row level security;
revoke all on public.provider_mapping_audit from anon, authenticated;
revoke all on public.provider_health from anon, authenticated;
