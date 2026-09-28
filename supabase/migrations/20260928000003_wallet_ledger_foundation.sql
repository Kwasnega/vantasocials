-- VANTA wallet ledger foundation. Deposits are intentionally not connected to Paystack.
create type public.wallet_transaction_type as enum ('DEPOSIT', 'ORDER_DEBIT', 'REFUND', 'MANUAL_ADJUSTMENT');
create type public.wallet_transaction_status as enum ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED');
create type public.wallet_entry_direction as enum ('CREDIT', 'DEBIT');

create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete restrict,
  currency char(3) not null default 'GHS' check (currency = 'GHS'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id) on delete restrict,
  type public.wallet_transaction_type not null,
  direction public.wallet_entry_direction not null,
  status public.wallet_transaction_status not null default 'COMPLETED',
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null default 'GHS' check (currency = 'GHS'),
  reference text not null unique,
  provider text,
  provider_reference text,
  order_id uuid references public.orders(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check ((type = 'DEPOSIT' and direction = 'CREDIT') or (type = 'ORDER_DEBIT' and direction = 'DEBIT') or (type = 'REFUND' and direction = 'CREDIT') or type = 'MANUAL_ADJUSTMENT'),
  check (type <> 'ORDER_DEBIT' or order_id is not null)
);

create unique index wallet_transactions_provider_reference_idx
  on public.wallet_transactions(provider, provider_reference)
  where provider is not null and provider_reference is not null;
create unique index wallet_transactions_order_debit_idx
  on public.wallet_transactions(order_id)
  where type = 'ORDER_DEBIT';
create unique index wallet_transactions_refund_reference_idx
  on public.wallet_transactions(order_id, reference)
  where type = 'REFUND';
create index wallet_transactions_wallet_created_idx on public.wallet_transactions(wallet_id, created_at desc);
create index wallet_transactions_order_idx on public.wallet_transactions(order_id);
create index wallet_transactions_status_created_idx on public.wallet_transactions(status, created_at);

create trigger wallets_set_updated_at before update on public.wallets for each row execute procedure public.set_updated_at();
create trigger wallet_transactions_set_updated_at before update on public.wallet_transactions for each row execute procedure public.set_updated_at();

alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
create policy "customers can view their wallet" on public.wallets for select using (auth.uid() = user_id);
create policy "customers can view their wallet transactions" on public.wallet_transactions for select using (exists (select 1 from public.wallets where wallets.id = wallet_transactions.wallet_id and wallets.user_id = auth.uid()));
revoke all on public.wallets from anon, authenticated;
revoke all on public.wallet_transactions from anon, authenticated;
grant select on public.wallets to authenticated;
grant select on public.wallet_transactions to authenticated;

create or replace function public.wallet_balance_minor(p_wallet_id uuid)
returns bigint
language sql
stable
security invoker
as $$
  select coalesce(sum(case when direction = 'CREDIT' then amount_minor else -amount_minor end), 0)::bigint
  from public.wallet_transactions
  where wallet_id = p_wallet_id and status = 'COMPLETED' and currency = 'GHS';
$$;

create or replace function public.debit_wallet_for_order(p_order_id uuid, p_reference text)
returns public.wallet_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders;
  target_wallet public.wallets;
  existing_debit public.wallet_transactions;
  balance bigint;
  amount_minor bigint;
  created_entry public.wallet_transactions;
begin
  select * into target_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  if auth.uid() is distinct from target_order.user_id and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'UNAUTHORIZED' using errcode = '42501'; end if;
  if target_order.currency <> 'GHS' or target_order.total is null then raise exception 'INVALID_CURRENCY' using errcode = '22023'; end if;
  amount_minor := round(target_order.total * 100)::bigint;
  if amount_minor <= 0 then raise exception 'INVALID_AMOUNT' using errcode = '22023'; end if;
  select * into existing_debit from public.wallet_transactions where order_id = p_order_id and type = 'ORDER_DEBIT' for update;
  if found then return existing_debit; end if;
  insert into public.wallets(user_id, currency) values (target_order.user_id, 'GHS') on conflict (user_id) do nothing;
  select * into target_wallet from public.wallets where user_id = target_order.user_id for update;
  balance := public.wallet_balance_minor(target_wallet.id);
  if balance < amount_minor then raise exception 'INSUFFICIENT_FUNDS' using errcode = 'P0001'; end if;
  insert into public.wallet_transactions(wallet_id,type,direction,status,amount_minor,currency,reference,order_id,metadata)
    values (target_wallet.id,'ORDER_DEBIT','DEBIT','COMPLETED',amount_minor,'GHS',p_reference,p_order_id,jsonb_build_object('source','server_order_payment'))
    returning * into created_entry;
  update public.orders set payment_status = 'PAID', status = 'PENDING_PAYMENT' where id = p_order_id and payment_status = 'UNPAID';
  return created_entry;
end;
$$;

revoke all on function public.debit_wallet_for_order(uuid, text) from public, anon, authenticated;
grant execute on function public.debit_wallet_for_order(uuid, text) to service_role;
