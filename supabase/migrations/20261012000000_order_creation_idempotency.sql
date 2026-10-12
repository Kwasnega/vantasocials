alter table public.orders
  add column idempotency_key text,
  add column idempotency_fingerprint text,
  add column idempotency_service_slug text,
  add constraint orders_user_id_idempotency_key_key unique (user_id, idempotency_key),
  add constraint orders_idempotency_metadata_complete_check
    check (
      num_nonnulls(idempotency_key, idempotency_fingerprint, idempotency_service_slug) in (0, 3)
      and (idempotency_key is null or idempotency_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      and (idempotency_fingerprint is null or idempotency_fingerprint ~ '^[0-9a-f]{64}$')
      and (idempotency_service_slug is null or length(trim(idempotency_service_slug)) > 0)
    );

create or replace function public.require_order_creation_idempotency()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.idempotency_key is null
     or new.idempotency_fingerprint is null
     or new.idempotency_service_slug is null then
    raise exception 'ORDER_IDEMPOTENCY_REQUIRED' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger orders_require_creation_idempotency
before insert on public.orders
for each row execute function public.require_order_creation_idempotency();
