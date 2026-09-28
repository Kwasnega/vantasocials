-- Phase 2G: durable, provider-scoped fulfillment attempt identity.
alter table public.provider_orders
  add column if not exists idempotency_key text,
  add column if not exists target_value text,
  add column if not exists provider_cost numeric(18,6),
  add column if not exists attempt_status text not null default 'NOT_ATTEMPTED',
  add column if not exists error_code text,
  add column if not exists request_started_at timestamptz,
  add column if not exists response_received_at timestamptz;
  
alter table public.provider_orders
  add column if not exists next_poll_at timestamptz,
  add column if not exists last_polled_at timestamptz,
  add column if not exists poll_attempts integer not null default 0;

alter table public.provider_orders
  add constraint provider_orders_attempt_status_check check (attempt_status in ('NOT_ATTEMPTED','PENDING_SUBMISSION','SUBMITTED','FAILED_BEFORE_SUBMISSION','UNKNOWN_PENDING_RECONCILIATION'));

create unique index if not exists provider_orders_idempotency_key_idx
  on public.provider_orders (idempotency_key) where idempotency_key is not null;

-- One active provider attempt per VANTA order. Terminal historical attempts remain allowed.
create unique index if not exists provider_orders_one_active_attempt_per_order_idx
  on public.provider_orders (order_id)
  where attempt_status in ('PENDING_SUBMISSION','SUBMITTED','UNKNOWN_PENDING_RECONCILIATION')
    or status in ('PROCESSING','SUBMITTED');

create index if not exists orders_fulfillment_worker_idx
  on public.orders (payment_status, fulfillment_status, created_at)
  where payment_status = 'PAID' and fulfillment_status in ('NOT_STARTED', 'FAILED');
