-- Wallet hardening: projection, immutable ledger accounting, and privileged refunds.
-- This migration does not connect Paystack deposits or expose refund mutations.

alter table public.wallets
  add column balance_minor bigint not null default 0
    check (balance_minor >= 0);

update public.wallets w
set balance_minor = coalesce((
  select sum(case when t.direction = 'CREDIT' then t.amount_minor else -t.amount_minor end)
  from public.wallet_transactions t
  where t.wallet_id = w.id and t.status = 'COMPLETED' and t.currency = 'GHS'
), 0)::bigint;

create or replace function public.wallet_balance_minor(p_wallet_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(balance_minor, 0)::bigint
  from public.wallets
  where id = p_wallet_id;
$$;

revoke all on function public.wallet_balance_minor(uuid) from public, anon, authenticated;
grant execute on function public.wallet_balance_minor(uuid) to service_role;

create or replace function public.apply_wallet_transaction_projection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  delta bigint;
begin
  if new.currency <> 'GHS' then
    raise exception 'INVALID_CURRENCY' using errcode = '22023';
  end if;
  if new.status <> 'COMPLETED' then
    return new;
  end if;
  delta := case when new.direction = 'CREDIT' then new.amount_minor else -new.amount_minor end;
  update public.wallets
    set balance_minor = balance_minor + delta
  where id = new.wallet_id;
  if not found then
    raise exception 'WALLET_NOT_FOUND' using errcode = 'P0002';
  end if;
  return new;
end;
$$;

revoke all on function public.apply_wallet_transaction_projection() from public, anon, authenticated;

create trigger wallet_transaction_projection_after_insert
after insert on public.wallet_transactions
for each row execute function public.apply_wallet_transaction_projection();

create or replace function public.prevent_wallet_transaction_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'WALLET_LEDGER_IMMUTABLE' using errcode = '55000';
end;
$$;

create trigger wallet_transactions_immutable
before update or delete on public.wallet_transactions
for each row execute function public.prevent_wallet_transaction_mutation();

create or replace function public.reconcile_wallet(p_wallet_id uuid)
returns table (
  wallet_id uuid,
  ledger_derived_balance bigint,
  projected_balance bigint,
  balance_matches boolean,
  negative_balance boolean,
  unsupported_currency boolean,
  invalid_completed_transaction boolean,
  orphaned_transaction boolean,
  duplicate_order_debit boolean
)
language sql
security definer
set search_path = public
as $$
  with wallet_row as (
    select w.id, w.balance_minor, w.currency
    from public.wallets w where w.id = p_wallet_id
  ), tx as (
    select t.*
    from public.wallet_transactions t
    where t.wallet_id = p_wallet_id
  ), derived as (
    select coalesce(sum(case when t.direction = 'CREDIT' then t.amount_minor else -t.amount_minor end)
      filter (where t.status = 'COMPLETED' and t.currency = 'GHS'), 0)::bigint as amount
    from tx t
  ), duplicate_debits as (
    select exists (
      select 1 from tx t
      where t.type = 'ORDER_DEBIT'
      group by t.order_id having count(*) > 1
    ) as found
  )
  select w.id,
    d.amount,
    w.balance_minor,
    d.amount = w.balance_minor,
    w.balance_minor < 0,
    w.currency <> 'GHS' or exists (select 1 from tx t where t.currency <> 'GHS'),
    exists (select 1 from tx t where t.status = 'COMPLETED' and (t.amount_minor <= 0 or (t.type = 'ORDER_DEBIT' and t.direction <> 'DEBIT') or (t.type in ('DEPOSIT','REFUND') and t.direction <> 'CREDIT'))),
    exists (select 1 from tx t left join wallets tw on tw.id = t.wallet_id where tw.id is null),
    dd.found
  from wallet_row w cross join derived d cross join duplicate_debits dd;
$$;

revoke all on function public.reconcile_wallet(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_wallet(uuid) to service_role;

create or replace function public.refund_wallet_order(p_order_id uuid)
returns public.wallet_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders;
  original_debit public.wallet_transactions;
  existing_refund public.wallet_transactions;
  target_wallet public.wallets;
  refund_entry public.wallet_transactions;
  refund_reference text := 'wallet-refund:order:' || p_order_id::text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  select * into target_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  if target_order.currency <> 'GHS' or target_order.total is null then raise exception 'INVALID_CURRENCY' using errcode = '22023'; end if;
  select * into target_wallet from public.wallets where user_id = target_order.user_id for update;
  if not found then raise exception 'WALLET_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into original_debit from public.wallet_transactions where order_id = p_order_id and wallet_id = target_wallet.id and type = 'ORDER_DEBIT' and status = 'COMPLETED' for update;
  if not found then raise exception 'ORIGINAL_DEBIT_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into existing_refund from public.wallet_transactions where reference = refund_reference for update;
  if found then return existing_refund; end if;
  if target_order.payment_status <> 'PAID' then raise exception 'ORDER_NOT_REFUNDABLE' using errcode = 'P0001'; end if;
  if original_debit.amount_minor <> round(target_order.total * 100)::bigint then raise exception 'REFUND_AMOUNT_MISMATCH' using errcode = '22023'; end if;
  insert into public.wallet_transactions(wallet_id,type,direction,status,amount_minor,currency,reference,order_id,metadata)
    values (target_wallet.id,'REFUND','CREDIT','COMPLETED',original_debit.amount_minor,'GHS',refund_reference,p_order_id,jsonb_build_object('source','server_order_refund'))
    returning * into refund_entry;
  return refund_entry;
end;
$$;

revoke all on function public.refund_wallet_order(uuid) from public, anon, authenticated;
grant execute on function public.refund_wallet_order(uuid) to service_role;

create index if not exists wallet_transactions_wallet_status_idx
  on public.wallet_transactions(wallet_id, status);
