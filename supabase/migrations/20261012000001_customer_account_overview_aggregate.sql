create or replace function public.get_customer_account_overview(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  with per_currency as (
    select
      currency,
      count(*) as total_orders,
      count(*) filter (where fulfillment_status = 'COMPLETED') as completed_orders,
      count(*) filter (where fulfillment_status in ('PROCESSING', 'SUBMITTING', 'SUBMITTED')) as processing_orders,
      count(*) filter (
        where payment_status in ('UNPAID', 'PENDING')
          or fulfillment_status = 'FAILED'
      ) as pending_orders,
      sum(total) filter (where payment_status = 'PAID') as paid_total
    from public.orders
    where user_id = p_user_id
    group by currency
  )
  select jsonb_build_object(
    'total_orders', coalesce(sum(total_orders), 0),
    'completed_orders', coalesce(sum(completed_orders), 0),
    'processing_orders', coalesce(sum(processing_orders), 0),
    'pending_orders', coalesce(sum(pending_orders), 0),
    'spend_by_currency', coalesce(
      jsonb_agg(jsonb_build_object('currency', currency, 'total', paid_total::text)
        order by currency) filter (where paid_total is not null),
      '[]'::jsonb
    )
  )
  from per_currency;
$$;

revoke all on function public.get_customer_account_overview(uuid) from public, anon, authenticated;
grant execute on function public.get_customer_account_overview(uuid) to service_role;
