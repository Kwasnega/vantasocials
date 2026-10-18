create or replace function public.admin_wipe_order_financial_data(p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  order_count bigint;
  payment_count bigint;
  deposit_count bigint;
  wallet_transaction_count bigint;
  provider_order_count bigint;
  provider_event_count bigint;
  claim_count bigint;
  webhook_event_count bigint;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  if p_confirmation is distinct from 'WIPE ALL DATA' then
    raise exception 'INVALID_CONFIRMATION' using errcode = '22023';
  end if;

  lock table
    public.orders,
    public.payments,
    public.provider_orders,
    public.provider_order_events,
    public.fulfillment_order_claims,
    public.wallet_transactions,
    public.wallet_deposit_payments,
    public.webhook_events
  in access exclusive mode;

  if exists (
    select 1
    from public.orders
    where payment_status = 'PENDING'
      or status = 'PROCESSING'
      or fulfillment_status in ('SUBMITTING', 'SUBMITTED', 'PROCESSING')
  ) or exists (
    select 1
    from public.provider_orders
    where attempt_status in ('PENDING_SUBMISSION', 'SUBMITTED', 'UNKNOWN_PENDING_RECONCILIATION')
      or status in ('SUBMITTED', 'PROCESSING')
  ) or exists (
    select 1
    from public.fulfillment_order_claims
    where released_at is null
      and expires_at > timezone('utc', now())
  ) then
    raise exception 'WIPE_BLOCKED_ACTIVE_FULFILLMENT' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.payments where status = 'PENDING') then
    raise exception 'WIPE_BLOCKED_PENDING_PAYMENT' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.wallet_deposit_payments
    where status in ('PENDING', 'INITIALIZING', 'AUTHORIZED')
  ) then
    raise exception 'WIPE_BLOCKED_PENDING_DEPOSIT' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.webhook_events
    where provider = 'paystack'
      and processing
  ) then
    raise exception 'WIPE_BLOCKED_ACTIVE_WEBHOOK' using errcode = 'P0001';
  end if;

  select count(*) into order_count from public.orders;
  select count(*) into payment_count from public.payments;
  select count(*) into deposit_count from public.wallet_deposit_payments;
  select count(*) into wallet_transaction_count from public.wallet_transactions;
  select count(*) into provider_order_count from public.provider_orders;
  select count(*) into provider_event_count from public.provider_order_events;
  select count(*) into claim_count from public.fulfillment_order_claims;
  select count(*) into webhook_event_count from public.webhook_events where provider = 'paystack';

  delete from public.payments;
  delete from public.wallet_deposit_payments;
  delete from public.fulfillment_order_claims;
  delete from public.webhook_events where provider = 'paystack';
  truncate table public.provider_order_events, public.wallet_transactions;
  delete from public.provider_orders;
  delete from public.orders;
  update public.wallets set balance_minor = 0;

  return jsonb_build_object(
    'orders', order_count,
    'payments', payment_count,
    'wallet_deposits', deposit_count,
    'wallet_transactions', wallet_transaction_count,
    'provider_orders', provider_order_count,
    'provider_events', provider_event_count,
    'fulfillment_claims', claim_count,
    'paystack_webhook_events', webhook_event_count
  );
end;
$$;

revoke all on function public.admin_wipe_order_financial_data(text) from public, anon, authenticated;
grant execute on function public.admin_wipe_order_financial_data(text) to service_role;
