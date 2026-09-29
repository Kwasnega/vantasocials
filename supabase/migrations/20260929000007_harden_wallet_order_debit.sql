-- Harden wallet order debit authorization and retry behavior.
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
  if auth.uid() is distinct from target_order.user_id and coalesce(auth.role(), '') <> 'service_role' then raise exception 'UNAUTHORIZED' using errcode = '42501'; end if;
  if target_order.currency <> 'GHS' or target_order.total is null then raise exception 'INVALID_CURRENCY' using errcode = '22023'; end if;
  amount_minor := round(target_order.total * 100)::bigint;
  if amount_minor <= 0 then raise exception 'INVALID_AMOUNT' using errcode = '22023'; end if;
  select * into existing_debit from public.wallet_transactions where order_id = p_order_id and type = 'ORDER_DEBIT' for update;
  if found then
    if existing_debit.amount_minor <> amount_minor or existing_debit.currency <> target_order.currency then raise exception 'ORDER_DEBIT_MISMATCH' using errcode = '22023'; end if;
    update public.orders set payment_status = 'PAID', status = 'PENDING_PAYMENT' where id = p_order_id and payment_status = 'UNPAID';
    return existing_debit;
  end if;
  insert into public.wallets(user_id, currency) values (target_order.user_id, 'GHS') on conflict (user_id) do nothing;
  select * into target_wallet from public.wallets where user_id = target_order.user_id for update;
  if target_wallet.currency <> 'GHS' then raise exception 'INVALID_CURRENCY' using errcode = '22023'; end if;
  balance := public.wallet_balance_minor(target_wallet.id);
  if balance < amount_minor then raise exception 'INSUFFICIENT_FUNDS' using errcode = 'P0001'; end if;
  insert into public.wallet_transactions(wallet_id,type,direction,status,amount_minor,currency,reference,order_id,metadata)
    values (target_wallet.id,'ORDER_DEBIT','DEBIT','COMPLETED',amount_minor,'GHS',p_reference,p_order_id,jsonb_build_object('source','server_order_payment'))
    returning * into created_entry;
  update public.orders set payment_status = 'PAID', status = 'PENDING_PAYMENT' where id = p_order_id and payment_status = 'UNPAID';
  if not found then raise exception 'ORDER_PAYMENT_STATE_CONFLICT' using errcode = '40001'; end if;
  return created_entry;
end;
$$;

revoke all on function public.debit_wallet_for_order(uuid, text) from public, anon, authenticated;
grant execute on function public.debit_wallet_for_order(uuid, text) to service_role;
