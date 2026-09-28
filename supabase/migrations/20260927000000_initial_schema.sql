-- VANTA Phase 1 database foundation. This migration contains no payment or provider integration.
create extension if not exists pgcrypto;

create type public.order_status as enum ('DRAFT', 'PENDING_PAYMENT', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'FAILED');
create type public.payment_status as enum ('UNPAID', 'PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');
create type public.fulfillment_status as enum ('NOT_STARTED', 'SUBMITTING', 'SUBMITTED', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');
create type public.target_type as enum ('username', 'url', 'post_url', 'video_url', 'channel', 'page');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.platforms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null unique,
  logo text not null,
  color text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  provider_service_id text,
  platform_id uuid not null references public.platforms(id) on delete restrict,
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  category text not null,
  description text,
  service_type text not null default 'standard',
  target_type public.target_type not null,
  min_quantity integer not null check (min_quantity > 0),
  max_quantity integer not null check (max_quantity >= min_quantity),
  provider_rate numeric(18,6),
  selling_rate numeric(18,6) not null check (selling_rate >= 0),
  currency char(3) not null default 'GHS' check (currency ~ '^[A-Z]{3}$'),
  active boolean not null default true,
  provider_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (platform_id, name)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  public_order_id text not null unique default ('VNT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
  user_id uuid not null references public.profiles(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  target_type public.target_type not null,
  target_value text not null check (length(trim(target_value)) > 0),
  quantity integer not null check (quantity > 0),
  unit_price numeric(18,6) not null check (unit_price >= 0),
  subtotal numeric(18,2) not null check (subtotal >= 0),
  total numeric(18,2) not null check (total >= 0),
  currency char(3) not null default 'GHS' check (currency ~ '^[A-Z]{3}$'),
  status public.order_status not null default 'DRAFT',
  payment_status public.payment_status not null default 'UNPAID',
  fulfillment_status public.fulfillment_status not null default 'NOT_STARTED',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  user_id uuid not null,
  provider text not null,
  reference text not null,
  amount numeric(18,2) not null check (amount >= 0),
  currency char(3) not null default 'GHS' check (currency ~ '^[A-Z]{3}$'),
  status public.payment_status not null default 'PENDING',
  paid_at timestamptz,
  provider_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (provider, reference),
  foreign key (order_id, user_id) references public.orders(id, user_id) on delete restrict
);

create table public.provider_orders (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  provider text not null,
  provider_order_id text,
  provider_service_id text not null,
  quantity integer not null check (quantity > 0),
  charge numeric(18,6),
  currency char(3) not null default 'GHS' check (currency ~ '^[A-Z]{3}$'),
  status public.fulfillment_status not null default 'NOT_STARTED',
  start_count integer,
  remains integer,
  raw_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (provider, provider_order_id),
  unique (order_id, attempt_number)
);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  signature text,
  processed boolean not null default false,
  processed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (provider, event_id)
);

create index orders_user_created_at_idx on public.orders (user_id, created_at desc);
create index orders_service_id_idx on public.orders (service_id);
create index orders_pending_fulfillment_idx on public.orders (fulfillment_status, created_at) where fulfillment_status in ('NOT_STARTED', 'FAILED');
create index services_platform_active_idx on public.services (platform_id, active);
create index payments_order_id_idx on public.payments (order_id);
create index payments_user_created_at_idx on public.payments (user_id, created_at desc);
create index provider_orders_status_idx on public.provider_orders (status, created_at);
create index webhook_events_unprocessed_idx on public.webhook_events (provider, created_at) where not processed;

create view public.service_catalog with (security_barrier = true) as
select id, platform_id, name, slug, category, description, service_type, target_type,
  min_quantity, max_quantity, selling_rate, currency, active, created_at, updated_at
from public.services
where active = true;

create view public.customer_provider_order_status with (security_barrier = true) as
select provider_orders.id, provider_orders.order_id, provider_orders.status,
  provider_orders.start_count, provider_orders.remains, provider_orders.created_at,
  provider_orders.updated_at
from public.provider_orders
join public.orders on orders.id = provider_orders.order_id
where orders.user_id = auth.uid();

create view public.customer_payment_status with (security_barrier = true) as
select id, order_id, provider, reference, amount, currency, status, paid_at, created_at, updated_at
from public.payments
where user_id = auth.uid();

create trigger profiles_set_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
create trigger platforms_set_updated_at before update on public.platforms for each row execute procedure public.set_updated_at();
create trigger services_set_updated_at before update on public.services for each row execute procedure public.set_updated_at();
create trigger orders_set_updated_at before update on public.orders for each row execute procedure public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments for each row execute procedure public.set_updated_at();
create trigger provider_orders_set_updated_at before update on public.provider_orders for each row execute procedure public.set_updated_at();

insert into public.platforms (slug, name, logo, color, description) values
  ('instagram', 'Instagram', 'IG', '#df41ef', 'Build momentum across your profile and posts.'),
  ('tiktok', 'TikTok', 'TT', '#09a3f8', 'Give your videos a stronger start.'),
  ('youtube', 'YouTube', 'YT', '#ff5b00', 'Grow subscribers and video engagement.'),
  ('facebook', 'Facebook', 'f', '#099df4', 'Support pages, posts, and video content.'),
  ('x', 'X', 'X', '#170529', 'Build reach and engagement around your posts.'),
  ('telegram', 'Telegram', 'TG', '#089df4', 'Grow channels and content visibility.');

alter table public.profiles enable row level security;
alter table public.platforms enable row level security;
alter table public.services enable row level security;
alter table public.orders enable row level security;
alter table public.payments enable row level security;
alter table public.provider_orders enable row level security;
alter table public.webhook_events enable row level security;

create policy "profiles are visible to their owner" on public.profiles for select using (auth.uid() = id);
create policy "profiles are editable by their owner" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "active platforms are public" on public.platforms for select using (active = true);
create policy "customers can view their orders" on public.orders for select using (auth.uid() = user_id);

revoke all on table public.services from anon, authenticated;
revoke all on table public.payments from anon, authenticated;
revoke all on table public.provider_orders from anon, authenticated;
revoke all on table public.webhook_events from anon, authenticated;
revoke all on public.service_catalog from public;
revoke all on public.customer_provider_order_status from public;
revoke all on public.customer_payment_status from public;
grant select on public.service_catalog to anon, authenticated;
grant select on public.customer_provider_order_status to authenticated;
grant select on public.customer_payment_status to authenticated;

-- Database writes for orders, payments, provider orders, and webhook events remain server-only.
