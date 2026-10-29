create table public.payment_provider_reference_claims (
  provider text not null check (provider = 'paystack'),
  actual_provider_reference text not null check (
    length(actual_provider_reference) between 1 and 255
  ),
  payment_id uuid not null references public.payments(id) on delete restrict,
  claimed_at timestamptz not null default timezone('utc', now()),
  primary key (provider, actual_provider_reference)
);

do $$
begin
  if exists (
    select 1
      from (
        select p.id as payment_id, p.reference as provider_reference
          from public.payments p
         where p.provider = 'paystack'
        union all
        select p.id as payment_id, p.gateway_reference as provider_reference
          from public.payments p
         where p.provider = 'bundleup_gateway'
           and p.gateway_reference is not null
      ) ref_rows
     group by ref_rows.provider_reference
    having count(distinct ref_rows.payment_id) > 1
  ) then
    raise exception 'Cannot backfill Paystack reference claims: conflicting payment references exist.';
  end if;

  if exists (
    select 1
      from public.payments p
     where p.provider = 'bundleup_gateway'
       and p.status = 'PAID'
  ) then
    raise exception 'Cannot install gateway settlement: pre-existing paid gateway attempts require evidence review.';
  end if;

  if exists (
    select 1
      from public.payments p
     where p.provider = 'bundleup_gateway'
       and p.gateway_intent_id is not null
       and p.gateway_intent_id is distinct from encode(
         extensions.digest(
           convert_to('vanta', 'UTF8')
             || decode('00', 'hex')
             || convert_to('idempotency:' || lower(p.id::text), 'UTF8'),
           'sha256'
         ),
         'hex'
       )
  ) then
    raise exception 'Cannot install gateway settlement: existing intent identities are not deterministic.';
  end if;
end;
$$;

insert into public.payment_provider_reference_claims (
  provider,
  actual_provider_reference,
  payment_id
)
select 'paystack', ref_rows.provider_reference, ref_rows.payment_id
  from (
    select p.id as payment_id, p.reference as provider_reference
      from public.payments p
     where p.provider = 'paystack'
    union all
    select p.id as payment_id, p.gateway_reference as provider_reference
      from public.payments p
     where p.provider = 'bundleup_gateway'
       and p.gateway_reference is not null
  ) ref_rows;

create table public.bundleup_gateway_reconciliation_requests (
  id uuid primary key,
  payment_id uuid not null,
  order_id uuid not null,
  user_id uuid not null,
  tenant_id text not null check (tenant_id = 'vanta'),
  request_nonce text not null unique check (
    request_nonce ~ '^[A-Za-z0-9_-]{16,128}$'
  ),
  request_timestamp text not null check (request_timestamp ~ '^[0-9]{10}$'),
  request_body bytea not null check (octet_length(request_body) between 1 and 1024),
  order_reference text not null check (
    order_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency = 'GHS'),
  intent_id text check (intent_id is null or intent_id ~ '^[0-9a-f]{64}$'),
  state text not null default 'OPEN' check (
    state in ('OPEN', 'OBSERVED', 'CONSUMED', 'EXPIRED', 'ABANDONED')
  ),
  response_outcome text check (
    response_outcome is null
    or response_outcome in (
      'payment_verified',
      'initialized',
      'pending',
      'failed',
      'unresolved',
      'not_found'
    )
  ),
  response_payload bytea,
  response_signature bytea check (
    response_signature is null or octet_length(response_signature) = 64
  ),
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  responded_at timestamptz,
  unique (id, payment_id),
  unique (payment_id, request_nonce),
  foreign key (payment_id) references public.payments(id) on delete restrict,
  foreign key (order_id, user_id) references public.orders(id, user_id) on delete restrict,
  check ((response_payload is null) = (response_signature is null)),
  check (
    (state in ('OBSERVED', 'CONSUMED', 'EXPIRED') and response_outcome is not null)
    or (state in ('OPEN', 'ABANDONED') and response_outcome is null)
  )
);

create index bundleup_gateway_reconciliation_requests_payment_created_idx
  on public.bundleup_gateway_reconciliation_requests (payment_id, created_at desc);

create table public.bundleup_gateway_payment_evidence (
  payment_id uuid primary key references public.payments(id) on delete restrict,
  request_id uuid not null unique,
  contract_version smallint not null check (contract_version = 1),
  key_id text not null check (key_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  tenant_id text not null check (tenant_id = 'vanta'),
  order_reference text not null check (
    order_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  intent_id text not null check (intent_id ~ '^[0-9a-f]{64}$'),
  provider text not null check (provider = 'paystack'),
  provider_reference text not null check (
    length(provider_reference) between 1 and 255
  ),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency = 'GHS'),
  provider_status text not null check (provider_status = 'success'),
  issued_at timestamptz not null,
  verified_at timestamptz not null,
  transaction_id text check (transaction_id is null or length(transaction_id) between 1 and 128),
  request_nonce text not null unique check (
    request_nonce ~ '^[A-Za-z0-9_-]{16,128}$'
  ),
  signed_payload bytea not null check (octet_length(signed_payload) between 1 and 16384),
  signature bytea not null check (octet_length(signature) = 64),
  created_at timestamptz not null default timezone('utc', now()),
  unique (intent_id),
  unique (provider, provider_reference),
  foreign key (request_id, payment_id)
    references public.bundleup_gateway_reconciliation_requests(id, payment_id)
    on delete restrict
);

alter table public.payments
  drop constraint payments_bundleup_gateway_fields_check;

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

alter table public.payments
  add constraint payments_bundleup_gateway_deterministic_intent_check check (
    provider <> 'bundleup_gateway'
    or gateway_intent_id is null
    or gateway_intent_id = encode(
      extensions.digest(
        convert_to('vanta', 'UTF8')
          || decode('00', 'hex')
          || convert_to('idempotency:' || lower(id::text), 'UTF8'),
        'sha256'
      ),
      'hex'
    )
  );

create or replace function public.claim_paystack_provider_reference(
  p_payment_id uuid,
  p_provider_reference text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_payment_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_payment_id is null
     or p_provider_reference is null
     or length(p_provider_reference) not between 1 and 255 then
    raise exception 'INVALID_PROVIDER_REFERENCE' using errcode = '22023';
  end if;

  insert into public.payment_provider_reference_claims (
    provider, actual_provider_reference, payment_id
  )
  values ('paystack', p_provider_reference, p_payment_id)
  on conflict (provider, actual_provider_reference) do nothing;

  select c.payment_id
    into v_existing_payment_id
    from public.payment_provider_reference_claims c
   where c.provider = 'paystack'
     and c.actual_provider_reference = p_provider_reference;
  if v_existing_payment_id is distinct from p_payment_id then
    raise exception 'PROVIDER_REFERENCE_ALREADY_CLAIMED' using errcode = '23505';
  end if;
end;
$$;

create or replace function public.claim_payment_provider_reference_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  if new.provider = 'paystack' then
    perform public.claim_paystack_provider_reference(new.id, new.reference);
  elsif new.provider = 'bundleup_gateway' and new.gateway_reference is not null then
    perform public.claim_paystack_provider_reference(new.id, new.gateway_reference);
  end if;
  return new;
end;
$$;

create trigger payments_claim_paystack_provider_reference
  after insert or update on public.payments
  for each row
  when (
    new.provider in ('paystack', 'bundleup_gateway')
  )
  execute function public.claim_payment_provider_reference_after_write();

create or replace function public.guard_pending_external_payment_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if new.provider not in ('paystack', 'bundleup_gateway') or new.status <> 'PENDING' then
    return new;
  end if;

  select o.*
    into v_order
    from public.orders o
   where o.id = new.order_id
     and o.user_id = new.user_id
   for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_order.status <> 'PENDING_PAYMENT' or v_order.payment_status <> 'UNPAID' then
    raise exception 'ORDER_NOT_PAYABLE' using errcode = '22023';
  end if;

  if exists (
    select 1
      from public.payments p
     where p.order_id = new.order_id
       and p.provider in ('paystack', 'bundleup_gateway')
       and p.status = 'PENDING'
  ) then
    raise exception 'ANOTHER_PAYMENT_ATTEMPT_ACTIVE' using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger payments_guard_pending_external_insert
  before insert on public.payments
  for each row
  execute function public.guard_pending_external_payment_insert();

create or replace function public.guard_bundleup_gateway_paid_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.provider = 'bundleup_gateway'
     and new.status = 'PAID'
     and old.status is distinct from 'PAID'
     and not exists (
       select 1
         from public.bundleup_gateway_payment_evidence e
        where e.payment_id = new.id
     ) then
    raise exception 'BUNDLEUP_GATEWAY_EVIDENCE_REQUIRED' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger payments_require_bundleup_gateway_evidence
  before update of status on public.payments
  for each row
  execute function public.guard_bundleup_gateway_paid_state();

create or replace function public.create_bundleup_gateway_reconciliation_request(
  p_request_id uuid,
  p_payment_id uuid,
  p_expected_user_id uuid,
  p_request_nonce text,
  p_request_timestamp text,
  p_request_body bytea
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_order public.orders;
  v_payment public.payments;
  v_body jsonb;
  v_amount_minor bigint;
  v_existing public.bundleup_gateway_reconciliation_requests;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_request_id is null
     or p_payment_id is null
     or p_expected_user_id is null
     or p_request_nonce !~ '^[A-Za-z0-9_-]{16,128}$'
     or p_request_timestamp !~ '^[0-9]{10}$'
     or p_request_body is null
     or octet_length(p_request_body) not between 1 and 1024 then
    raise exception 'INVALID_RECONCILIATION_REQUEST' using errcode = '22023';
  end if;
  if abs(extract(epoch from clock_timestamp())::bigint - p_request_timestamp::bigint) > 300 then
    raise exception 'STALE_RECONCILIATION_REQUEST' using errcode = '22023';
  end if;

  select p.order_id into v_order_id
    from public.payments p
   where p.id = p_payment_id and p.user_id = p_expected_user_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select o.* into v_order
    from public.orders o
   where o.id = v_order_id and o.user_id = p_expected_user_id
   for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.* into v_payment
    from public.payments p
   where p.id = p_payment_id
     and p.order_id = v_order_id
     and p.user_id = p_expected_user_id
     and p.provider = 'bundleup_gateway'
   for update;
  if not found
     or v_payment.status <> 'PENDING'
     or v_payment.gateway_initialization_status not in (
       'INITIALIZING', 'INITIALIZATION_UNKNOWN', 'INITIALIZED'
     )
     or v_order.status <> 'PENDING_PAYMENT'
     or v_order.payment_status <> 'UNPAID' then
    raise exception 'PAYMENT_NOT_RECONCILABLE' using errcode = '40001';
  end if;

  v_amount_minor := round(v_payment.amount * 100)::bigint;
  if v_payment.currency <> 'GHS'
     or v_order.currency <> v_payment.currency
     or round(v_order.total * 100)::bigint <> v_amount_minor
     or v_payment.gateway_order_reference is distinct from v_order.public_order_id then
    raise exception 'PAYMENT_TERMS_MISMATCH' using errcode = '22023';
  end if;

  begin
    v_body := convert_from(p_request_body, 'UTF8')::jsonb;
  exception when others then
    raise exception 'INVALID_RECONCILIATION_REQUEST_BODY' using errcode = '22023';
  end;
  if jsonb_typeof(v_body) <> 'object'
     or (select count(*) from jsonb_object_keys(v_body)) not in (5, 6)
     or v_body->>'tenant_id' <> 'vanta'
     or v_body->>'payment_id' <> lower(p_payment_id::text)
     or v_body->>'order_reference' <> v_order.public_order_id
     or jsonb_typeof(v_body->'amount_minor') <> 'number'
     or (v_body->>'amount_minor')::numeric <> v_amount_minor
     or v_body->>'currency' <> 'GHS'
     or (v_body ? 'intent_id') <> (v_payment.gateway_intent_id is not null)
     or (
       v_payment.gateway_intent_id is not null
       and v_body->>'intent_id' is distinct from v_payment.gateway_intent_id
     )
     or exists (
       select 1
         from jsonb_object_keys(v_body) k
        where k not in ('tenant_id', 'payment_id', 'order_reference', 'amount_minor', 'currency', 'intent_id')
     ) then
    raise exception 'RECONCILIATION_REQUEST_TERMS_MISMATCH' using errcode = '22023';
  end if;

  select r.* into v_existing
    from public.bundleup_gateway_reconciliation_requests r
   where r.id = p_request_id;
  if found then
    if v_existing.payment_id = p_payment_id
       and v_existing.user_id = p_expected_user_id
       and v_existing.request_nonce = p_request_nonce
       and v_existing.request_timestamp = p_request_timestamp
       and v_existing.request_body = p_request_body then
      return p_request_id;
    end if;
    raise exception 'RECONCILIATION_REQUEST_ID_CONFLICT' using errcode = '23505';
  end if;

  insert into public.bundleup_gateway_reconciliation_requests (
    id, payment_id, order_id, user_id, tenant_id, request_nonce,
    request_timestamp, request_body, order_reference, amount_minor,
    currency, intent_id, state, created_at, expires_at
  )
  values (
    p_request_id, p_payment_id, v_order_id, p_expected_user_id, 'vanta',
    p_request_nonce, p_request_timestamp, p_request_body,
    v_order.public_order_id, v_amount_minor, v_payment.currency,
    v_payment.gateway_intent_id, 'OPEN', timezone('utc', now()),
    timezone('utc', now()) + interval '5 minutes'
  );
  return p_request_id;
end;
$$;

create or replace function public.record_bundleup_gateway_reconciliation_observation(
  p_request_id uuid,
  p_payment_id uuid,
  p_expected_user_id uuid,
  p_signed_payload bytea,
  p_signature bytea,
  p_outcome text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.bundleup_gateway_reconciliation_requests;
  v_payload jsonb;
  v_state text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_outcome is null
     or p_outcome not in ('initialized', 'pending', 'failed', 'unresolved', 'not_found')
     or p_signed_payload is null
     or octet_length(p_signed_payload) not between 1 and 16384
     or p_signature is null
     or octet_length(p_signature) <> 64 then
    raise exception 'INVALID_RECONCILIATION_OBSERVATION' using errcode = '22023';
  end if;
  begin
    v_payload := convert_from(p_signed_payload, 'UTF8')::jsonb;
  exception when others then
    raise exception 'INVALID_RECONCILIATION_OBSERVATION' using errcode = '22023';
  end;

  select r.* into v_request
    from public.bundleup_gateway_reconciliation_requests r
   where r.id = p_request_id and r.payment_id = p_payment_id
     and r.user_id = p_expected_user_id
   for update;
  if not found or v_request.state <> 'OPEN' then
    raise exception 'RECONCILIATION_REQUEST_NOT_OPEN' using errcode = '40001';
  end if;
  if v_payload->>'payment_id' is distinct from lower(p_payment_id::text)
     or v_payload->>'tenant_id' is distinct from 'vanta'
     or v_payload->>'request_nonce' is distinct from v_request.request_nonce
     or v_payload->>'order_reference' is distinct from v_request.order_reference
     or v_payload->>'outcome' is distinct from p_outcome then
    raise exception 'RECONCILIATION_OBSERVATION_MISMATCH' using errcode = '22023';
  end if;

  v_state := case when v_request.expires_at <= timezone('utc', now()) then 'EXPIRED' else 'OBSERVED' end;
  update public.bundleup_gateway_reconciliation_requests
     set state = v_state,
         response_outcome = p_outcome,
         response_payload = p_signed_payload,
         response_signature = p_signature,
         responded_at = timezone('utc', now())
   where id = p_request_id and state = 'OPEN';
  return v_state;
end;
$$;

create or replace function public.settle_bundleup_gateway_order_payment(
  p_payment_id uuid,
  p_expected_user_id uuid,
  p_request_id uuid,
  p_signed_payload bytea,
  p_signature bytea
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
  v_order_id uuid;
  v_order public.orders;
  v_payment public.payments;
  v_request public.bundleup_gateway_reconciliation_requests;
  v_existing_evidence public.bundleup_gateway_payment_evidence;
  v_payload jsonb;
  v_intent_id text;
  v_reference text;
  v_amount_minor bigint;
  v_issued_at timestamptz;
  v_verified_at timestamptz;
  v_transaction_id text;
  v_already_settled boolean := false;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_payment_id is null
     or p_expected_user_id is null
     or p_request_id is null
     or p_signed_payload is null
     or octet_length(p_signed_payload) not between 1 and 16384
     or p_signature is null
     or octet_length(p_signature) <> 64 then
    raise exception 'INVALID_VERIFIED_EVIDENCE' using errcode = '22023';
  end if;
  begin
    v_payload := convert_from(p_signed_payload, 'UTF8')::jsonb;
  exception when others then
    raise exception 'INVALID_VERIFIED_EVIDENCE' using errcode = '22023';
  end;

  select p.order_id into v_order_id
    from public.payments p
   where p.id = p_payment_id and p.user_id = p_expected_user_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select o.* into v_order
    from public.orders o
   where o.id = v_order_id and o.user_id = p_expected_user_id
   for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.* into v_payment
    from public.payments p
   where p.id = p_payment_id
     and p.order_id = v_order_id
     and p.user_id = p_expected_user_id
     and p.provider = 'bundleup_gateway'
   for update;
  if not found then
    raise exception 'GATEWAY_PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select r.* into v_request
    from public.bundleup_gateway_reconciliation_requests r
   where r.id = p_request_id and r.payment_id = p_payment_id
     and r.order_id = v_order_id and r.user_id = p_expected_user_id
   for update;
  if not found then
    raise exception 'RECONCILIATION_REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_payload->>'version' is distinct from '1'
     or jsonb_typeof(v_payload->'version') is distinct from 'number'
     or (select count(*) from jsonb_object_keys(v_payload)) <> 16
     or v_payload->>'tenant_id' is distinct from 'vanta'
     or v_payload->>'payment_id' is distinct from lower(p_payment_id::text)
     or v_payload->>'order_reference' is distinct from v_request.order_reference
     or v_payload->>'request_nonce' is distinct from v_request.request_nonce
     or v_payload->>'outcome' is distinct from 'payment_verified'
     or v_payload->>'provider' is distinct from 'paystack'
     or v_payload->>'provider_status' is distinct from 'success'
     or v_payload->>'currency' is distinct from 'GHS'
     or jsonb_typeof(v_payload->'amount_minor') is distinct from 'number'
     or (v_payload->>'amount_minor')::numeric <= 0
     or (v_payload->>'amount_minor')::numeric > 9007199254740991
     or trunc((v_payload->>'amount_minor')::numeric) <> (v_payload->>'amount_minor')::numeric
     or v_payload->>'key_id' is null
     or v_payload->>'key_id' !~ '^[A-Za-z0-9._-]{1,64}$'
     or v_payload->>'intent_id' is null
     or v_payload->>'intent_id' !~ '^[0-9a-f]{64}$'
     or v_payload->>'reference' is null
     or v_payload->>'reference' is distinct from ('VANTA-' || (v_payload->>'intent_id'))
     or v_payload->>'issued_at' is null
     or v_payload->>'issued_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
     or v_payload->>'verified_at' is null
     or v_payload->>'verified_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' then
    raise exception 'VERIFIED_EVIDENCE_INVALID' using errcode = '22023';
  end if;
  if not (v_payload ? 'transaction_id')
     or jsonb_typeof(v_payload->'transaction_id') not in ('string', 'null')
     or (
       jsonb_typeof(v_payload->'transaction_id') = 'string'
       and length(v_payload->>'transaction_id') not between 1 and 128
     ) then
    raise exception 'VERIFIED_EVIDENCE_INVALID' using errcode = '22023';
  end if;

  v_intent_id := v_payload->>'intent_id';
  v_reference := v_payload->>'reference';
  v_amount_minor := (v_payload->>'amount_minor')::bigint;
  v_issued_at := (v_payload->>'issued_at')::timestamptz;
  v_verified_at := (v_payload->>'verified_at')::timestamptz;
  v_transaction_id := v_payload->>'transaction_id';

  if v_intent_id <> encode(
       extensions.digest(
         convert_to('vanta', 'UTF8')
           || decode('00', 'hex')
           || convert_to('idempotency:' || lower(p_payment_id::text), 'UTF8'),
         'sha256'
       ),
       'hex'
     )
     or v_request.tenant_id is distinct from 'vanta'
     or v_request.amount_minor <> v_amount_minor
     or v_request.currency is distinct from v_payload->>'currency'
     or (
       v_request.intent_id is not null
       and v_request.intent_id is distinct from v_intent_id
     )
     or v_request.order_reference is distinct from v_order.public_order_id
     or v_order.status <> 'PENDING_PAYMENT'
     or v_order.payment_status not in ('UNPAID', 'PAID')
     or v_verified_at > v_issued_at
     or v_payload->>'transaction_id' is not null and (
       jsonb_typeof(v_payload->'transaction_id') <> 'string'
       or length(v_transaction_id) not between 1 and 128
     ) then
    raise exception 'VERIFIED_EVIDENCE_TERMS_MISMATCH' using errcode = '22023';
  end if;

  if v_payment.currency <> 'GHS'
     or v_order.currency <> 'GHS'
     or round(v_payment.amount * 100)::bigint <> v_amount_minor
     or round(v_order.total * 100)::bigint <> v_amount_minor
     or v_payment.gateway_order_reference is distinct from v_order.public_order_id
     or v_payment.gateway_intent_id is not null and v_payment.gateway_intent_id <> v_intent_id
     or v_payment.gateway_reference is not null and v_payment.gateway_reference <> v_reference
     or v_payment.gateway_initialization_status = 'INITIALIZATION_REJECTED' then
    raise exception 'PAYMENT_TERMS_MISMATCH' using errcode = '22023';
  end if;

  select e.* into v_existing_evidence
    from public.bundleup_gateway_payment_evidence e
   where e.payment_id = p_payment_id
   for update;
  if found then
    if v_payment.status = 'PAID'
       and v_order.payment_status = 'PAID'
       and not exists (
         select 1
           from public.payments other_payment
          where other_payment.order_id = v_order_id
            and other_payment.status = 'PAID'
            and other_payment.id <> p_payment_id
       )
       and v_existing_evidence.tenant_id = 'vanta'
       and v_existing_evidence.order_reference = v_order.public_order_id
       and v_existing_evidence.intent_id = v_intent_id
       and v_existing_evidence.provider_reference = v_reference
       and exists (
         select 1
           from public.payment_provider_reference_claims c
          where c.provider = 'paystack'
            and c.actual_provider_reference = v_reference
            and c.payment_id = p_payment_id
       )
       and v_existing_evidence.amount_minor = v_amount_minor
       and v_existing_evidence.currency = 'GHS'
       and v_existing_evidence.provider_status = 'success'
       and v_existing_evidence.verified_at = v_verified_at
       and v_existing_evidence.transaction_id is not distinct from v_transaction_id
       and (
         (
           v_request.state = 'CONSUMED'
           and v_existing_evidence.request_id = p_request_id
           and v_existing_evidence.request_nonce = v_request.request_nonce
           and v_existing_evidence.signed_payload = p_signed_payload
           and v_existing_evidence.signature = p_signature
         )
         or (
           v_request.state = 'OPEN'
           and v_request.expires_at > timezone('utc', now())
           and v_existing_evidence.request_id <> p_request_id
         )
       ) then
      if v_request.state = 'OPEN' then
        update public.bundleup_gateway_reconciliation_requests
           set state = 'CONSUMED',
               response_outcome = 'payment_verified',
               response_payload = p_signed_payload,
               response_signature = p_signature,
               responded_at = timezone('utc', now())
         where id = p_request_id;
      end if;
      return query select p_payment_id, v_order_id, true, true;
      return;
    end if;
    raise exception 'CONFLICTING_CANONICAL_EVIDENCE' using errcode = '23505';
  end if;

  if abs(extract(epoch from clock_timestamp() - v_issued_at)) > 300
     or v_verified_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'VERIFIED_EVIDENCE_EXPIRED' using errcode = '22023';
  end if;

  if exists (
    select 1
      from public.payments other_payment
     where other_payment.order_id = v_order_id
       and other_payment.status = 'PAID'
       and other_payment.id <> p_payment_id
  ) then
    raise exception 'ORDER_PAID_BY_DIFFERENT_PAYMENT' using errcode = '40001';
  end if;

  if v_request.state <> 'OPEN'
     or v_request.expires_at <= timezone('utc', now()) then
    raise exception 'RECONCILIATION_REQUEST_NOT_CONSUMABLE' using errcode = '40001';
  end if;
  if v_payment.status <> 'PENDING'
     or v_order.payment_status <> 'UNPAID'
     or v_order.status <> 'PENDING_PAYMENT' then
    raise exception 'ORDER_PAYMENT_STATE_CONFLICT' using errcode = '40001';
  end if;

  perform public.claim_paystack_provider_reference(p_payment_id, v_reference);

  insert into public.bundleup_gateway_payment_evidence (
    payment_id, request_id, contract_version, key_id, tenant_id,
    order_reference, intent_id, provider, provider_reference, amount_minor,
    currency, provider_status, issued_at, verified_at, transaction_id,
    request_nonce, signed_payload, signature
  )
  values (
    p_payment_id, p_request_id, 1, v_payload->>'key_id', 'vanta',
    v_order.public_order_id, v_intent_id, 'paystack', v_reference,
    v_amount_minor, 'GHS', 'success', v_issued_at, v_verified_at,
    v_transaction_id, v_request.request_nonce, p_signed_payload, p_signature
  );

  update public.bundleup_gateway_reconciliation_requests
     set state = 'CONSUMED',
         response_outcome = 'payment_verified',
         response_payload = p_signed_payload,
         response_signature = p_signature,
         responded_at = timezone('utc', now())
   where id = p_request_id and state = 'OPEN'
     and expires_at > timezone('utc', now());
  if not found then
    raise exception 'RECONCILIATION_REQUEST_EXPIRED' using errcode = '40001';
  end if;

  update public.payments
     set status = 'PAID',
         paid_at = coalesce(paid_at, timezone('utc', now()))
   where id = p_payment_id and provider = 'bundleup_gateway'
     and status = 'PENDING';
  if not found then
    raise exception 'PAYMENT_STATE_CONFLICT' using errcode = '40001';
  end if;

  update public.orders
     set payment_status = 'PAID'
   where id = v_order_id and user_id = p_expected_user_id
     and payment_status = 'UNPAID' and status = 'PENDING_PAYMENT';
  if not found then
    raise exception 'ORDER_STATE_CONFLICT' using errcode = '40001';
  end if;

  return query select p_payment_id, v_order_id, true, false;
end;
$$;

drop function public.reserve_bundleup_gateway_payment_attempt(uuid, uuid, text);

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
  if p_order_id is null or p_expected_user_id is null
     or p_return_url is null or p_return_url !~ '^https://[^#[:space:]]+$' then
    raise exception 'INVALID_GATEWAY_PAYMENT_TERMS' using errcode = '22023';
  end if;

  select o.* into v_order
    from public.orders o
   where o.id = p_order_id and o.user_id = p_expected_user_id
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

  select lower(trim(p.email)) into v_email
    from public.profiles p where p.id = v_order.user_id;
  if v_email is null or length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'CUSTOMER_EMAIL_INVALID' using errcode = '22023';
  end if;

  select p.* into v_payment
    from public.payments p
   where p.order_id = v_order.id
     and p.status = 'PENDING'
     and p.provider in ('paystack', 'bundleup_gateway');
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
    id, order_id, user_id, provider, reference, amount, currency, status,
    gateway_initialization_status, gateway_order_reference,
    gateway_customer_email, gateway_return_url, provider_response
  )
  values (
    v_payment_id, v_order.id, v_order.user_id, 'bundleup_gateway',
    'VANTA-GW-' || replace(v_payment_id::text, '-', ''),
    v_order.total, v_order.currency, 'PENDING', 'RESERVED',
    v_order.public_order_id, v_email, p_return_url, '{}'::jsonb
  )
  returning * into v_payment;
  return next v_payment;
end;
$$;

revoke all on table public.payment_provider_reference_claims from public, anon, authenticated;
revoke all on table public.bundleup_gateway_reconciliation_requests from public, anon, authenticated;
revoke all on table public.bundleup_gateway_payment_evidence from public, anon, authenticated;
revoke all on table public.payment_provider_reference_claims from service_role;
revoke all on table public.bundleup_gateway_reconciliation_requests from service_role;
revoke all on table public.bundleup_gateway_payment_evidence from service_role;
grant select on table public.bundleup_gateway_reconciliation_requests to service_role;
grant select on table public.bundleup_gateway_payment_evidence to service_role;
grant select on table public.payment_provider_reference_claims to service_role;

revoke all on function public.claim_paystack_provider_reference(uuid, text) from public, anon, authenticated;
revoke all on function public.claim_payment_provider_reference_after_write() from public, anon, authenticated;
revoke all on function public.guard_pending_external_payment_insert() from public, anon, authenticated;
revoke all on function public.guard_bundleup_gateway_paid_state() from public, anon, authenticated;
revoke all on function public.create_bundleup_gateway_reconciliation_request(uuid, uuid, uuid, text, text, bytea) from public, anon, authenticated;
revoke all on function public.record_bundleup_gateway_reconciliation_observation(uuid, uuid, uuid, bytea, bytea, text) from public, anon, authenticated;
revoke all on function public.settle_bundleup_gateway_order_payment(uuid, uuid, uuid, bytea, bytea) from public, anon, authenticated;
revoke all on function public.reserve_bundleup_gateway_payment_attempt(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_bundleup_gateway_reconciliation_request(uuid, uuid, uuid, text, text, bytea) to service_role;
grant execute on function public.record_bundleup_gateway_reconciliation_observation(uuid, uuid, uuid, bytea, bytea, text) to service_role;
grant execute on function public.settle_bundleup_gateway_order_payment(uuid, uuid, uuid, bytea, bytea) to service_role;
grant execute on function public.reserve_bundleup_gateway_payment_attempt(uuid, uuid, text) to service_role;
