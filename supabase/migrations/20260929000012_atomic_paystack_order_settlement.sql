create or replace function public.settle_paystack_order_payment(
  p_payment_id uuid,
  p_expected_user_id uuid,
  p_verified_reference text,
  p_verified_amount_minor bigint,
  p_verified_currency text,
  p_transaction_id text,
  p_provider_response jsonb
)
returns table (
  payment_id uuid,
  order_id uuid,
  settled boolean,
  already_settled boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments;
  v_order public.orders;
begin
  if p_verified_reference is null
     or length(trim(p_verified_reference)) = 0
     or p_verified_amount_minor is null
     or p_verified_amount_minor <= 0
     or p_verified_currency <> 'GHS' then
    raise exception 'INVALID_VERIFIED_PAYMENT' using errcode = '22023';
  end if;

  select * into v_payment
    from public.payments
   where id = p_payment_id and provider = 'paystack'
   for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_payment.user_id <> p_expected_user_id then raise exception 'PAYMENT_USER_MISMATCH' using errcode = '42501'; end if;
  if v_payment.reference <> p_verified_reference then raise exception 'PAYMENT_REFERENCE_MISMATCH' using errcode = '22023'; end if;
  if v_payment.currency <> p_verified_currency then raise exception 'PAYMENT_CURRENCY_MISMATCH' using errcode = '22023'; end if;
  if round(v_payment.amount * 100)::bigint <> p_verified_amount_minor then raise exception 'PAYMENT_AMOUNT_MISMATCH' using errcode = '22023'; end if;

  select * into v_order
    from public.orders
   where id = v_payment.order_id and user_id = v_payment.user_id
   for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_order.currency <> p_verified_currency or round(v_order.total * 100)::bigint <> p_verified_amount_minor then
    raise exception 'ORDER_PAYMENT_TERMS_MISMATCH' using errcode = '22023';
  end if;

  if v_payment.status = 'PAID' and v_order.payment_status = 'PAID' then
    return query select v_payment.id, v_order.id, true, true;
    return;
  end if;
  if v_payment.status <> 'PENDING' or v_order.payment_status <> 'UNPAID' or v_order.status <> 'PENDING_PAYMENT' then
    raise exception 'ORDER_PAYMENT_STATE_CONFLICT' using errcode = '40001';
  end if;

  update public.payments
     set status = 'PAID', paid_at = coalesce(paid_at, timezone('utc', now())),
         provider_response = coalesce(p_provider_response, '{}'::jsonb) || jsonb_build_object('transaction_id', p_transaction_id)
   where id = v_payment.id and status = 'PENDING';
  if not found then raise exception 'PAYMENT_STATE_CONFLICT' using errcode = '40001'; end if;

  update public.orders set payment_status = 'PAID'
   where id = v_order.id and payment_status = 'UNPAID' and status = 'PENDING_PAYMENT';
  if not found then raise exception 'ORDER_STATE_CONFLICT' using errcode = '40001'; end if;

  return query select v_payment.id, v_order.id, true, false;
end;
$$;

revoke all on function public.settle_paystack_order_payment(uuid, uuid, text, bigint, text, text, jsonb) from public;
revoke all on function public.settle_paystack_order_payment(uuid, uuid, text, bigint, text, text, jsonb) from anon;
revoke all on function public.settle_paystack_order_payment(uuid, uuid, text, bigint, text, text, jsonb) from authenticated;
grant execute on function public.settle_paystack_order_payment(uuid, uuid, text, bigint, text, text, jsonb) to service_role;
