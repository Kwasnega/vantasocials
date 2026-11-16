-- Migration: Deposit checks, reconciliation, and audit fields
create table if not exists public.deposit_checks (
  id uuid primary key default gen_random_uuid(),
  deposit_id uuid not null references public.wallet_deposit_payments(id) on delete cascade,
  reference text not null,
  status text not null,
  paystack_status text,
  amount_minor bigint,
  currency text,
  paid_at timestamptz,
  gateway_response text,
  raw_response jsonb not null default '{}'::jsonb,
  checked_by uuid references public.profiles(id) on delete set null,
  checked_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists deposit_checks_deposit_id_idx on public.deposit_checks(deposit_id, checked_at desc);
create index if not exists deposit_checks_reference_idx on public.deposit_checks(reference);

-- Add reconciliation columns to wallet_deposit_payments if not present
alter table public.wallet_deposit_payments
  add column if not exists is_reconciled boolean not null default false,
  add column if not exists reconciled_at timestamptz,
  add column if not exists reconciled_by uuid references public.profiles(id) on delete set null,
  add column if not exists reconciliation_note text,
  add column if not exists linked_transaction_id uuid references public.wallet_transactions(id) on delete set null,
  add column if not exists last_checked_at timestamptz,
  add column if not exists last_paystack_status text;

-- RLS for deposit_checks
alter table public.deposit_checks enable row level security;

create policy "admins can view and insert deposit checks"
  on public.deposit_checks
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  );

grant select, insert, update on public.deposit_checks to authenticated;
grant all on public.deposit_checks to service_role;
