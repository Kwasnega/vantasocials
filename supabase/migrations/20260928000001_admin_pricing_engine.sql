-- Admin pricing/economics foundation. Not applied automatically.
alter table public.services
  add column if not exists provider text,
  add column if not exists provider_service_id text,
  add column if not exists provider_rate numeric(24,12),
  add column if not exists provider_rate_unit text,
  add column if not exists provider_currency char(3),
  add column if not exists provider_rate_last_synced timestamptz,
  add column if not exists provider_rate_source text;

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

create table if not exists public.pricing_settings (
  key text primary key,
  fx_rate numeric(24,12) not null check (fx_rate > 0),
  fx_source text not null default 'MANUAL',
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references auth.users(id)
);

create table if not exists public.pricing_audit_log (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references public.services(id),
  field text not null check (field in ('selling_price','fx_rate','provider_rate')),
  old_value numeric(24,12),
  new_value numeric(24,12) not null,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default timezone('utc', now())
);

create index if not exists pricing_audit_service_idx on public.pricing_audit_log(service_id, changed_at desc);

alter table public.pricing_settings enable row level security;
alter table public.pricing_audit_log enable row level security;
revoke all on public.pricing_settings from anon, authenticated;
revoke all on public.pricing_audit_log from anon, authenticated;
