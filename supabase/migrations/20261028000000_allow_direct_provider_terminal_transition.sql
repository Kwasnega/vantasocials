create or replace function public.transition_fulfillment_state(
  p_order_id uuid,
  p_from public.fulfillment_status,
  p_to public.fulfillment_status
) returns boolean
language plpgsql
security definer
set search_path=public
as $$
begin
  if not (
    (p_from='NOT_STARTED' and p_to='SUBMITTING')
    or (p_from='SUBMITTING' and p_to in ('SUBMITTED','FAILED'))
    or (p_from='SUBMITTED' and p_to in ('PROCESSING','COMPLETED','PARTIAL','FAILED','CANCELLED'))
    or (p_from='PROCESSING' and p_to in ('COMPLETED','PARTIAL','FAILED','CANCELLED'))
  ) then
    return false;
  end if;

  update public.orders
  set fulfillment_status=p_to
  where id=p_order_id and fulfillment_status=p_from;
  if not found then
    return false;
  end if;

  insert into public.provider_order_events(order_id,event_type,metadata)
  values(p_order_id,'CUSTOMER_FULFILLMENT_TRANSITION',jsonb_build_object('from',p_from,'to',p_to));
  return true;
end;
$$;

revoke all on function public.transition_fulfillment_state(uuid,public.fulfillment_status,public.fulfillment_status) from public,anon,authenticated;
grant execute on function public.transition_fulfillment_state(uuid,public.fulfillment_status,public.fulfillment_status) to service_role;
