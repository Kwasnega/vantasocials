alter table public.payments
  add column gateway_initialization_status text,
  add column gateway_order_reference text,
  add column gateway_customer_email text,
  add column gateway_return_url text,
  add column gateway_intent_id text,
  add column gateway_reference text,
  add column gateway_authorization_url text;

alter table public.payments
  add constraint payments_bundleup_gateway_fields_check check (
    (
      provider = 'bundleup_gateway'
      and gateway_initialization_status is not null
      and gateway_initialization_status in (
        'RESERVED',
        'INITIALIZING',
        'INITIALIZATION_UNKNOWN',
        'INITIALIZED',
        'INITIALIZATION_REJECTED'
      )
      and gateway_order_reference is not null
      and length(trim(gateway_order_reference)) > 0
      and gateway_customer_email is not null
      and length(trim(gateway_customer_email)) > 0
      and gateway_return_url is not null
      and gateway_return_url like 'https://%'
      and (
        (
          gateway_initialization_status = 'INITIALIZED'
          and gateway_intent_id is not null
          and gateway_intent_id ~ '^[0-9a-f]{64}$'
          and gateway_reference is not null
          and gateway_reference = 'VANTA-' || gateway_intent_id
          and gateway_authorization_url is not null
          and gateway_authorization_url like 'https://%'
          and length(gateway_authorization_url) <= 2048
        )
        or
        (
          gateway_initialization_status <> 'INITIALIZED'
          and gateway_intent_id is null
          and gateway_reference is null
          and gateway_authorization_url is null
        )
      )
      and (
        (gateway_initialization_status = 'INITIALIZATION_REJECTED' and status = 'FAILED')
        or
        (
          gateway_initialization_status <> 'INITIALIZATION_REJECTED'
          and status in ('PENDING', 'PAID')
          and (status <> 'PAID' or gateway_initialization_status = 'INITIALIZED')
        )
      )
    )
    or
    (
      provider <> 'bundleup_gateway'
      and gateway_initialization_status is null
      and gateway_order_reference is null
      and gateway_customer_email is null
      and gateway_return_url is null
      and gateway_intent_id is null
      and gateway_reference is null
      and gateway_authorization_url is null
    )
  );

create unique index payments_bundleup_gateway_intent_id_idx
  on public.payments (gateway_intent_id)
  where gateway_intent_id is not null;

create unique index payments_bundleup_gateway_reference_idx
  on public.payments (gateway_reference)
  where gateway_reference is not null;

do $$
begin
  if exists (
    select 1
      from public.payments
     where provider in ('paystack', 'bundleup_gateway')
       and status = 'PENDING'
     group by order_id
    having count(*) > 1
  ) then
    raise exception 'Cannot create active payment index: an order has multiple pending external payments.';
  end if;
end;
$$;

create unique index payments_one_pending_external_payment_per_order_idx
  on public.payments (order_id)
  where provider in ('paystack', 'bundleup_gateway') and status = 'PENDING';

create or replace function public.prevent_bundleup_gateway_payment_term_changes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.provider = 'bundleup_gateway' or new.provider = 'bundleup_gateway' then
    if row(
      new.order_id,
      new.user_id,
      new.provider,
      new.reference,
      new.amount,
      new.currency,
      new.gateway_order_reference,
      new.gateway_customer_email,
      new.gateway_return_url
    ) is distinct from row(
      old.order_id,
      old.user_id,
      old.provider,
      old.reference,
      old.amount,
      old.currency,
      old.gateway_order_reference,
      old.gateway_customer_email,
      old.gateway_return_url
    ) then
      raise exception 'BUNDLEUP_GATEWAY_PAYMENT_TERMS_IMMUTABLE' using errcode = '22023';
    end if;

    if old.provider = 'bundleup_gateway'
       and new.gateway_initialization_status is distinct from old.gateway_initialization_status
       and not (
         (old.gateway_initialization_status = 'RESERVED' and new.gateway_initialization_status = 'INITIALIZING')
         or (
           old.gateway_initialization_status = 'INITIALIZING'
           and new.gateway_initialization_status in ('INITIALIZATION_UNKNOWN', 'INITIALIZED', 'INITIALIZATION_REJECTED')
         )
       ) then
      raise exception 'BUNDLEUP_GATEWAY_INITIALIZATION_TRANSITION_INVALID' using errcode = '22023';
    end if;

    if old.provider = 'bundleup_gateway'
       and old.gateway_intent_id is not null
       and row(new.gateway_intent_id, new.gateway_reference, new.gateway_authorization_url)
         is distinct from row(old.gateway_intent_id, old.gateway_reference, old.gateway_authorization_url) then
      raise exception 'BUNDLEUP_GATEWAY_INTENT_RESULT_IMMUTABLE' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger payments_prevent_bundleup_gateway_term_changes
  before update on public.payments
  for each row execute function public.prevent_bundleup_gateway_payment_term_changes();

create or replace function public.reserve_bundleup_gateway_payment_attempt(
  p_order_id uuid,
  p_expected_user_id uuid,
  p_return_url text
)
returns setof public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_email text;
  v_payment public.payments;
  v_payment_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_order_id is null
     or p_expected_user_id is null
     or p_return_url is null
     or p_return_url !~ '^https://[^#[:space:]]+$' then
    raise exception 'INVALID_GATEWAY_PAYMENT_TERMS' using errcode = '22023';
  end if;

  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
     and o.user_id = p_expected_user_id
   for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_order.status <> 'PENDING_PAYMENT'
     or v_order.payment_status <> 'UNPAID'
     or v_order.currency <> 'GHS'
     or v_order.total <= 0 then
    raise exception 'ORDER_NOT_PAYABLE' using errcode = '22023';
  end if;

  select lower(trim(p.email))
    into v_email
    from public.profiles p
   where p.id = v_order.user_id;
  if v_email is null or length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'CUSTOMER_EMAIL_INVALID' using errcode = '22023';
  end if;

  select p.*
    into v_payment
    from public.payments p
   where p.order_id = v_order.id
     and p.status = 'PENDING'
     and p.provider in ('paystack', 'bundleup_gateway')
   for update;
  if found then
    if v_payment.provider <> 'bundleup_gateway' then
      raise exception 'ANOTHER_PAYMENT_ATTEMPT_ACTIVE' using errcode = '23505';
    end if;
    if v_payment.gateway_order_reference is distinct from v_order.public_order_id
       or v_payment.amount is distinct from v_order.total
       or v_payment.currency is distinct from v_order.currency
       or v_payment.gateway_customer_email is distinct from v_email
       or v_payment.gateway_return_url is distinct from p_return_url then
      raise exception 'GATEWAY_PAYMENT_TERMS_MISMATCH' using errcode = '22023';
    end if;
    return next v_payment;
    return;
  end if;

  v_payment_id := gen_random_uuid();
  insert into public.payments (
    id,
    order_id,
    user_id,
    provider,
    reference,
    amount,
    currency,
    status,
    gateway_initialization_status,
    gateway_order_reference,
    gateway_customer_email,
    gateway_return_url,
    provider_response
  )
  values (
    v_payment_id,
    v_order.id,
    v_order.user_id,
    'bundleup_gateway',
    'VANTA-GW-' || replace(v_payment_id::text, '-', ''),
    v_order.total,
    v_order.currency,
    'PENDING',
    'RESERVED',
    v_order.public_order_id,
    v_email,
    p_return_url,
    '{}'::jsonb
  )
  returning * into v_payment;

  return next v_payment;
end;
$$;

create or replace function public.claim_bundleup_gateway_payment_initialization(
  p_payment_id uuid,
  p_expected_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  update public.payments p
     set gateway_initialization_status = 'INITIALIZING'
    from public.orders o
   where p.id = p_payment_id
     and p.user_id = p_expected_user_id
     and p.provider = 'bundleup_gateway'
     and p.status = 'PENDING'
     and p.gateway_initialization_status = 'RESERVED'
     and o.id = p.order_id
     and o.user_id = p.user_id
     and o.status = 'PENDING_PAYMENT'
     and o.payment_status = 'UNPAID'
  returning p.id into v_updated_id;

  return v_updated_id is not null;
end;
$$;

create or replace function public.mark_bundleup_gateway_payment_unknown(
  p_payment_id uuid,
  p_expected_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  update public.payments
     set gateway_initialization_status = 'INITIALIZATION_UNKNOWN'
   where id = p_payment_id
     and user_id = p_expected_user_id
     and provider = 'bundleup_gateway'
     and status = 'PENDING'
     and gateway_initialization_status = 'INITIALIZING'
  returning id into v_updated_id;

  return v_updated_id is not null;
end;
$$;

create or replace function public.complete_bundleup_gateway_payment_initialization(
  p_payment_id uuid,
  p_expected_user_id uuid,
  p_intent_id text,
  p_gateway_reference text,
  p_authorization_url text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_intent_id !~ '^[0-9a-f]{64}$'
     or p_gateway_reference is distinct from 'VANTA-' || p_intent_id
     or p_authorization_url is null
     or p_authorization_url !~ '^https://[^#[:space:]]+$'
     or length(p_authorization_url) > 2048 then
    raise exception 'INVALID_GATEWAY_INTENT_RESULT' using errcode = '22023';
  end if;

  update public.payments
     set gateway_initialization_status = 'INITIALIZED',
         gateway_intent_id = p_intent_id,
         gateway_reference = p_gateway_reference,
         gateway_authorization_url = p_authorization_url
   where id = p_payment_id
     and user_id = p_expected_user_id
     and provider = 'bundleup_gateway'
     and status = 'PENDING'
     and gateway_initialization_status = 'INITIALIZING'
  returning id into v_updated_id;

  return v_updated_id is not null;
end;
$$;

create or replace function public.reject_bundleup_gateway_payment_initialization(
  p_payment_id uuid,
  p_expected_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  update public.payments
     set gateway_initialization_status = 'INITIALIZATION_REJECTED',
         status = 'FAILED'
   where id = p_payment_id
     and user_id = p_expected_user_id
     and provider = 'bundleup_gateway'
     and status = 'PENDING'
     and gateway_initialization_status = 'INITIALIZING'
  returning id into v_updated_id;

  return v_updated_id is not null;
end;
$$;

revoke all on function public.reserve_bundleup_gateway_payment_attempt(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.claim_bundleup_gateway_payment_initialization(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mark_bundleup_gateway_payment_unknown(uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_bundleup_gateway_payment_initialization(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.reject_bundleup_gateway_payment_initialization(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reserve_bundleup_gateway_payment_attempt(uuid, uuid, text) to service_role;
grant execute on function public.claim_bundleup_gateway_payment_initialization(uuid, uuid) to service_role;
grant execute on function public.mark_bundleup_gateway_payment_unknown(uuid, uuid) to service_role;
grant execute on function public.complete_bundleup_gateway_payment_initialization(uuid, uuid, text, text, text) to service_role;
grant execute on function public.reject_bundleup_gateway_payment_initialization(uuid, uuid) to service_role;
