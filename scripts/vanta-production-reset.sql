-- ==============================================================================
-- VANTA PRODUCTION LAUNCH: TEST ACTIVITY DATABASE RESET SCRIPT (REVISED)
-- ==============================================================================
-- IMPORTANT:
-- This script safely cleans all test activity (orders, payments, test transactions,
-- fulfillment attempts, test deposits, and ephemeral rate limits) while preserving
-- 100% of platforms, services, dynamic inputs, mappings, catalog, and user accounts.
--
-- Note on Gateway Tables:
-- It uses dynamic checks (to_regclass) so that tables like
-- bundleup_gateway_payment_evidence, bundleup_gateway_reconciliation_requests,
-- and payment_provider_reference_claims are only deleted IF they exist.
--
-- Instructions:
-- Paste and run this script in the Supabase Dashboard SQL Editor:
-- https://supabase.com/dashboard/project/pmovqivnsqhsinlodmts/sql
-- ==============================================================================

DO $$
DECLARE
  v_in_flight_orders integer;
  v_active_claims integer;
  v_services_count integer;
  v_platforms_count integer;
  v_catalog_count integer;
BEGIN
  -- ----------------------------------------------------------------------------
  -- 1. PRECONDITION GUARDS & INTEGRITY CHECKS
  -- ----------------------------------------------------------------------------
  
  -- Verify service catalog is 100% intact before making any modifications
  SELECT count(*) INTO v_services_count FROM public.services;
  SELECT count(*) INTO v_platforms_count FROM public.platforms;
  SELECT count(*) INTO v_catalog_count FROM public.provider_catalog_services;
  
  IF v_services_count <> 26 THEN
    RAISE EXCEPTION 'PRECONDITION_FAILED: Expected 26 services, found %', v_services_count;
  END IF;
  
  IF v_platforms_count <> 13 THEN
    RAISE EXCEPTION 'PRECONDITION_FAILED: Expected 13 platforms, found %', v_platforms_count;
  END IF;

  IF v_catalog_count <> 4124 THEN
    RAISE EXCEPTION 'PRECONDITION_FAILED: Expected 4124 provider catalog services, found %', v_catalog_count;
  END IF;

  -- Ensure no orders are actively in-flight in external fulfillment
  SELECT count(*) INTO v_in_flight_orders
  FROM public.orders
  WHERE fulfillment_status IN ('SUBMITTING', 'SUBMITTED', 'PROCESSING');

  IF v_in_flight_orders > 0 THEN
    RAISE EXCEPTION 'PRECONDITION_FAILED: Found % in-flight fulfillment orders', v_in_flight_orders;
  END IF;

  -- Ensure no active, unexpired fulfillment worker leases are held
  SELECT count(*) INTO v_active_claims
  FROM public.fulfillment_order_claims
  WHERE released_at IS NULL AND expires_at > timezone('utc', now());

  IF v_active_claims > 0 THEN
    RAISE EXCEPTION 'PRECONDITION_FAILED: Found % active unexpired fulfillment claims', v_active_claims;
  END IF;

  -- ----------------------------------------------------------------------------
  -- 2. SEQUENTIAL DELETION IN STRICT TOPOLOGICAL (FOREIGN-KEY) ORDER
  -- ----------------------------------------------------------------------------

  -- Level 1: Gateway child tables (reconciliation evidence & handshake nonces)
  -- Uses conditional execution so it succeeds whether the migration has been applied or not
  IF to_regclass('public.bundleup_gateway_payment_evidence') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.bundleup_gateway_payment_evidence';
  END IF;

  IF to_regclass('public.bundleup_gateway_reconciliation_requests') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.bundleup_gateway_reconciliation_requests';
  END IF;

  -- Level 2: Provider reference deduplication claim registry
  IF to_regclass('public.payment_provider_reference_claims') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.payment_provider_reference_claims';
  END IF;

  -- Level 3: Checkout payment attempts and test deposit records
  DELETE FROM public.payments;
  DELETE FROM public.wallet_deposit_payments;

  -- Level 4: Worker lease claims
  DELETE FROM public.fulfillment_order_claims;

  -- Level 5: Append-only and trigger-guarded event & ledger tables
  -- (TRUNCATE is foreign-key safe and cleanly resets row-level immutable triggers)
  TRUNCATE TABLE public.provider_order_events;
  TRUNCATE TABLE public.wallet_transactions;

  -- Level 6: Provider fulfillment records
  DELETE FROM public.provider_orders;

  -- Level 7: Core customer test orders
  DELETE FROM public.orders;

  -- Level 8: Reset all wallet balances to zero (preserves user wallet rows & profile links)
  UPDATE public.wallets SET balance_minor = 0;

  -- Level 9: Webhook event records (clears Paystack test events)
  DELETE FROM public.webhook_events WHERE provider = 'paystack';

  -- Level 10: Ephemeral rate limit counters and pricing modification history
  TRUNCATE TABLE public.pricing_audit_log;
  TRUNCATE TABLE public.rate_limit_buckets;

  RAISE NOTICE 'VANTA test activity reset completed successfully.';
END $$;

-- ------------------------------------------------------------------------------
-- 3. POST-RESET VERIFICATION (RUN IMMEDIATELY AFTER EXECUTION)
-- ------------------------------------------------------------------------------
SELECT 
  (SELECT count(*) FROM public.orders) AS orders_count,                             -- Expected: 0
  (SELECT count(*) FROM public.payments) AS payments_count,                         -- Expected: 0
  (SELECT count(*) FROM public.wallet_transactions) AS wallet_transactions_count,   -- Expected: 0
  (SELECT count(*) FROM public.provider_orders) AS provider_orders_count,           -- Expected: 0
  (SELECT count(*) FROM public.provider_order_events) AS provider_events_count,     -- Expected: 0
  (SELECT count(*) FROM public.fulfillment_order_claims) AS claims_count,           -- Expected: 0
  (SELECT count(*) FROM public.wallet_deposit_payments) AS deposits_count,          -- Expected: 0
  (SELECT count(*) FROM public.pricing_audit_log) AS pricing_audit_count,           -- Expected: 0
  (SELECT count(*) FROM public.rate_limit_buckets) AS rate_limits_count,           -- Expected: 0
  (SELECT count(*) FROM public.wallets WHERE balance_minor <> 0) AS non_zero_wallets_count, -- Expected: 0
  (SELECT count(*) FROM public.platforms) AS platforms_count,                       -- Expected: 13 (Preserved)
  (SELECT count(*) FROM public.services) AS services_count,                         -- Expected: 26 (Preserved)
  (SELECT count(*) FROM public.service_input_fields) AS input_fields_count,         -- Expected: 1  (Preserved)
  (SELECT count(*) FROM public.service_provider_input_mappings) AS mappings_count,   -- Expected: 1  (Preserved)
  (SELECT count(*) FROM public.provider_catalog_services) AS catalog_count,        -- Expected: 4124 (Preserved)
  (SELECT count(*) FROM public.profiles) AS profiles_count;                         -- Expected: 6  (Preserved)
