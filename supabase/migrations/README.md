# Database Migrations Guide: Search & Performance Indexes

This guide details the exact order and execution rules for applying the database migrations created during the Admin Panel Optimization.

## ⚠️ CRITICAL EXECUTION NOTE

PostgreSQL **does not allow** `CREATE INDEX CONCURRENTLY` or `DROP INDEX CONCURRENTLY` to run inside a transaction block (`ERROR: 25001: CREATE INDEX CONCURRENTLY cannot run inside a transaction block`).

- When running through standard migration tools or the Supabase CLI (`supabase db push`), each statement must not be enclosed in `BEGIN ... COMMIT`.
- In the **Supabase Dashboard SQL Editor**, SQL statements are by default wrapped in an implicit transaction block. Therefore, index migrations in the repository are provided as standard idempotent index creations (`CREATE INDEX IF NOT EXISTS`) which can run directly in the SQL Editor.
- If applying via `psql` directly on production or staging, you can execute them concurrently using the `-c` flag or with autocommit enabled.

---

## 1. Migration Run Sequence

Execute the migrations in the following exact order:

### Step 1: Baseline Performance & Compound Indexes
**File**: `supabase/migrations/20261028000001_admin_performance_indexes.sql`  
**Purpose**:
- Adds compound index on `orders (created_at DESC, id DESC)` for deterministic keyset cursor pagination.
- Adds compound index on `profiles (created_at DESC, id DESC)`.
- Adds compound indexes for payments and wallet transactions.
- Adds index on `orders (payment_status, fulfillment_status)` for administrative filtering.

### Step 2: pg_trgm Search Extension & Trigram GIN Indexes
**File**: `supabase/migrations/20261029000001_admin_trgm_search_indexes.sql`  
**Purpose**:
- Installs `pg_trgm` extension in the `public` / `extensions` schema.
- Replaces legacy B-Tree / `text_pattern_ops` indexes with GIN trigram indexes (`gin_trgm_ops`) on:
  - `profiles.email` (contains-style customer search)
  - `orders.public_order_id` (fuzzy order lookup)
  - `orders.target_value` (fuzzy handle/URL search)
  - `provider_catalog_services.name` (catalog search)
  - `provider_catalog_services.provider_service_id`

### Step 3: Admin Compliance Audit Log
**File**: `supabase/migrations/20261029000002_admin_action_log.sql`  
**Purpose**:
- Creates `public.admin_action_log` table with RLS enabled.
- Restricts write and read access exclusively to `service_role`.
- Stores structured audit records for destructive admin mutations (such as data wipe and manual administrative adjustments).

---

## 2. Rollback Order

If any rollback is required, run the corresponding `.rollback.sql` files in **reverse order**:

1. `supabase/migrations/20261029000002_admin_action_log.rollback.sql`
2. `supabase/migrations/20261029000001_admin_trgm_search_indexes.rollback.sql`
3. `supabase/migrations/20261028000001_admin_performance_indexes.rollback.sql`
