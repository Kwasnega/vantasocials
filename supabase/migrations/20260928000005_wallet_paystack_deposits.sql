-- Wallet Paystack deposit reservations and atomic settlement.
create type public.wallet_deposit_status as enum ('PENDING', 'INITIALIZING', 'AUTHORIZED', 'PAID', 'FAILED', 'ABANDONED');

create table public.wallet_deposit_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  wallet_id uuid not null references public.wallets(id) on delete restrict,
  reference text not null unique,
  idempotency_key text not null,
  provider_reference text unique,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null default 'GHS' check (currency = 'GHS'),
  status public.wallet_deposit_status not null default 'PENDING',
  provider text not null default 'paystack' check (provider = 'paystack'),
  provider_response jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index wallet_deposit_payments_user_created_idx on public.wallet_deposit_payments(user_id, created_at desc);
create index wallet_deposit_payments_status_created_idx on public.wallet_deposit_payments(status, created_at);
create index wallet_deposit_payments_wallet_created_idx on public.wallet_deposit_payments(wallet_id, created_at desc);
create unique index wallet_deposit_payments_user_idempotency_idx on public.wallet_deposit_payments(user_id, idempotency_key);

create trigger wallet_deposit_payments_set_updated_at before update on public.wallet_deposit_payments for each row execute procedure public.set_updated_at();

alter table public.wallet_deposit_payments enable row level security;
create policy "customers can view their wallet deposits" on public.wallet_deposit_payments for select using (auth.uid() = user_id);
revoke all on public.wallet_deposit_payments from anon, authenticated;
grant select on public.wallet_deposit_payments to authenticated;

create or replace function public.credit_wallet_deposit(
  p_deposit_id uuid,
  p_user_id uuid,
  p_provider_reference text,
  p_amount_minor bigint,
  p_currency text
)
returns public.wallet_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  deposit public.wallet_deposit_payments;
  existing_credit public.wallet_transactions;
  credited public.wallet_transactions;
  credit_reference text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_provider_reference is null or length(trim(p_provider_reference)) = 0 then raise exception 'INVALID_PROVIDER_REFERENCE' using errcode = '22023'; end if;
  if p_amount_minor is null or p_amount_minor <= 0 or p_currency <> 'GHS' then raise exception 'INVALID_DEPOSIT_TERMS' using errcode = '22023'; end if;
  select * into deposit from public.wallet_deposit_payments where id = p_deposit_id for update;
  if not found or deposit.user_id <> p_user_id or deposit.currency <> 'GHS' or deposit.provider <> 'paystack' then raise exception 'DEPOSIT_NOT_FOUND' using errcode = 'P0002'; end if;
  if deposit.status = 'PAID' then
    select * into existing_credit from public.wallet_transactions where provider = 'PAYSTACK' and provider_reference = p_provider_reference and wallet_id = deposit.wallet_id and amount_minor = deposit.amount_minor and type = 'DEPOSIT' and direction = 'CREDIT' and status = 'COMPLETED' and metadata ->> 'deposit_id' = deposit.id::text for update;
    if found then return existing_credit; end if;
    raise exception 'PAID_DEPOSIT_CREDIT_MISSING' using errcode = 'P0001';
  end if;
  if deposit.status not in ('PENDING', 'AUTHORIZED') then raise exception 'DEPOSIT_NOT_SETTLEABLE' using errcode = '22023'; end if;
  if deposit.provider_reference is not null and deposit.provider_reference <> p_provider_reference then raise exception 'REFERENCE_MISMATCH' using errcode = '22023'; end if;
  if deposit.amount_minor <> p_amount_minor then raise exception 'AMOUNT_MISMATCH' using errcode = '22023'; end if;
  select * into existing_credit from public.wallet_transactions where provider = 'PAYSTACK' and provider_reference = p_provider_reference and wallet_id = deposit.wallet_id and amount_minor = deposit.amount_minor and type = 'DEPOSIT' and direction = 'CREDIT' and status = 'COMPLETED' and metadata ->> 'deposit_id' = deposit.id::text for update;
  if found then return existing_credit; end if;
  credit_reference := 'wallet-deposit:' || deposit.reference;
  insert into public.wallet_transactions(wallet_id,type,direction,status,amount_minor,currency,reference,provider,provider_reference,metadata)
    values (deposit.wallet_id,'DEPOSIT','CREDIT','COMPLETED',p_amount_minor,'GHS',credit_reference,'PAYSTACK',p_provider_reference,jsonb_build_object('deposit_id', deposit.id, 'reference', deposit.reference))
    returning * into credited;
  update public.wallet_deposit_payments set provider_reference = p_provider_reference, status = 'PAID', paid_at = coalesce(paid_at, timezone('utc', now())) where id = deposit.id;
  return credited;
exception when unique_violation then
  select * into existing_credit from public.wallet_transactions where provider = 'PAYSTACK' and provider_reference = p_provider_reference and wallet_id = deposit.wallet_id and amount_minor = deposit.amount_minor and type = 'DEPOSIT' and direction = 'CREDIT' and status = 'COMPLETED' and metadata ->> 'deposit_id' = deposit.id::text for update;
  if found then return existing_credit; end if;
  raise;
end;
$$;

revoke all on function public.credit_wallet_deposit(uuid, uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.credit_wallet_deposit(uuid, uuid, text, bigint, text) to service_role;
