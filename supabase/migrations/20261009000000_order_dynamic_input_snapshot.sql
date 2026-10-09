-- Phase 3.5: persist the VANTA-side schema snapshot and validated values for dynamic orders.

alter table public.orders
  add column if not exists input_schema_version integer,
  add column if not exists input_schema_snapshot jsonb,
  add column if not exists input_values jsonb;

create index if not exists orders_input_schema_version_idx
  on public.orders (input_schema_version)
  where input_schema_version is not null;
