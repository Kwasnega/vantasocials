-- Phase 2D: keep one retryable Paystack initialization per order.
create unique index payments_one_pending_paystack_per_order_idx
  on public.payments (order_id)
  where provider = 'paystack' and status = 'PENDING';
