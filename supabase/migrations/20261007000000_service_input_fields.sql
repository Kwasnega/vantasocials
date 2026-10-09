-- Phase 3.2 service input definitions and provider mapping metadata.

create table if not exists public.service_input_fields (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete restrict,
  key text not null check (length(trim(key)) > 0),
  label text not null check (length(trim(label)) > 0),
  input_type text not null check (length(trim(input_type)) > 0),
  required boolean not null,
  display_order integer not null check (display_order >= 0),
  placeholder text,
  help_text text,
  validation_config jsonb not null default '{}'::jsonb check (jsonb_typeof(validation_config) = 'object'),
  schema_version integer not null check (schema_version > 0),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (service_id, key),
  unique (service_id, id)
);

create table if not exists public.service_provider_input_mappings (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete restrict,
  service_input_field_id uuid not null,
  provider text not null,
  provider_service_id text not null,
  provider_parameter_key text not null,
  transform_id text not null,
  transform_version integer not null,
  provider_required boolean not null,
  omit_when_blank boolean not null,
  schema_version integer not null check (schema_version > 0),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint service_provider_input_mappings_service_field_fk
    foreign key (service_id, service_input_field_id)
    references public.service_input_fields(service_id, id)
    on delete restrict
);

create index if not exists service_input_fields_service_active_order_idx
  on public.service_input_fields (service_id, active, display_order);

create unique index if not exists service_provider_input_mappings_active_unique_idx
  on public.service_provider_input_mappings (service_id, service_input_field_id, provider, provider_service_id, schema_version)
  where active = true;

create index if not exists service_provider_input_mappings_service_active_idx
  on public.service_provider_input_mappings (service_id, active);

create index if not exists service_provider_input_mappings_field_active_idx
  on public.service_provider_input_mappings (service_input_field_id, active);

create trigger service_input_fields_set_updated_at
before update on public.service_input_fields
for each row
execute procedure public.set_updated_at();

create trigger service_provider_input_mappings_set_updated_at
before update on public.service_provider_input_mappings
for each row
execute procedure public.set_updated_at();

alter table public.service_input_fields enable row level security;
alter table public.service_provider_input_mappings enable row level security;

revoke all on public.service_input_fields from anon, authenticated;
revoke all on public.service_provider_input_mappings from anon, authenticated;
