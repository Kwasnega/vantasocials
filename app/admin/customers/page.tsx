import Link from "next/link";
import { requireAdmin } from "../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../lib/supabase/server";
import { AdminEmptyState, AdminQueryError } from "../AdminDataState";
import { AdminSearchInput } from "../../../components/admin/AdminSearchInput";
import { parseUuidCursor } from "../../../lib/admin/cursor-validation";

export default async function AdminCustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; cursor?: string }> }) {
  const { admin } = await requireAdmin();
  if (!admin) return null;
  const db = createSupabaseAdminClient();
  const p = await searchParams;
  const limit = 25;
  const isFiltered = Boolean(p.q?.trim());
  const countStrategy = isFiltered ? "exact" : "planned";

  // Keyset/cursor pagination with strict server-side validation
  let cursorCreatedAt: string | null = null;
  let cursorId: string | null = null;
  if (p.cursor) {
    try {
      const validated = parseUuidCursor(p.cursor);
      if (validated) {
        cursorCreatedAt = validated.createdAt;
        cursorId = validated.id;
      }
    } catch {
      return (
        <div className="customers-page">
          <header className="customers-hero"><h1>Invalid Cursor</h1></header>
          <AdminQueryError message="The pagination cursor is malformed or invalid. Please return to the first page." />
          <Link href="/admin/customers" style={{ marginTop: "1rem", display: "inline-block" }}>← Return to start</Link>
        </div>
      );
    }
  }

  let query = db.from("profiles").select("id,email,is_admin,created_at", { count: countStrategy });
  if (p.q?.trim()) query = query.ilike("email", `%${p.q.trim()}%`);
  // Keyset filter: rows with created_at strictly before cursor, OR same created_at but id < cursorId
  if (cursorCreatedAt && cursorId) {
    query = query.or(`created_at.lt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.lt.${cursorId})`);
  }
  const { data: customers, count, error: customersError } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(Math.min(limit, 100));

  const { data: wallets, error: walletsError } = customers?.length
    ? await db.from("wallets").select("user_id,balance_minor,currency").in("user_id", customers.map((x) => x.id))
    : { data: [], error: null };
  const total = count;
  const admins = (customers ?? []).filter((customer) => customer.is_admin).length;
  const walletTotals = (wallets ?? []).reduce<Record<string, number>>((totals, wallet) => {
    const currency = String(wallet.currency ?? "UNKNOWN");
    totals[currency] = (totals[currency] ?? 0) + Number(wallet.balance_minor ?? 0);
    return totals;
  }, {});

  // Build next cursor from the last row returned
  const hasNextPage = (customers?.length ?? 0) === limit;
  const lastCustomer = customers?.at(-1);
  const nextCursor = hasNextPage && lastCustomer
    ? Buffer.from(JSON.stringify({ created_at: lastCustomer.created_at, id: lastCustomer.id })).toString("base64")
    : null;

  // Count display: show "~N" for planned (approximate), "N" for exact
  const countLabel = customersError ? "Count unavailable" : total === null ? "" : isFiltered ? `${total} records` : `~${total} records`;

  return <div className="customers-page">
    <header className="customers-hero">
      <div>
        <p className="dashboard-kicker">ADMIN / DIRECTORY</p>
        <h1>Customers<span>.</span></h1>
        <p className="customers-intro">A clear view of every account, wallet balance, and access level across VANTA.</p>
      </div>
      <div className="customers-hero-mark" aria-hidden="true">V</div>
    </header>

    <section className="customer-stats" aria-label="Customer summary">
      <article><span>Total customers</span>{customersError ? <AdminQueryError message="Count unavailable." /> : <strong>{total === null ? "Unavailable" : isFiltered ? total : `~${total}`}</strong>}<small>Registered accounts</small></article>
      <article><span>On this page</span>{customersError ? <AdminQueryError message="Count unavailable." /> : <strong>{customers?.length ?? 0}</strong>}<small>Showing latest first</small></article>
      <article><span>Admin access</span>{customersError ? <AdminQueryError message="Count unavailable." /> : <strong>{admins}</strong>}<small>Privileged accounts on this page</small></article>
      <article><span>Wallets shown</span>{customersError || walletsError ? <AdminQueryError message="Wallet balances unavailable." /> : <strong>{Object.entries(walletTotals).map(([currency, minor]) => `${(minor / 100).toFixed(2)} ${currency}`).join(" · ") || "0.00"}</strong>}<small>Current page only; not total liability</small></article>
    </section>

    <section className="customers-panel">
      <div className="customers-panel-heading"><div><p className="dashboard-kicker">CUSTOMER DIRECTORY</p><h2>All accounts</h2></div><span>{countLabel}</span></div>
      <AdminSearchInput id="customer-search" name="q" initialValue={p.q} placeholder="Search by email address" buttonText="Search" />
      {customersError ? <AdminQueryError message="Customer records could not be loaded." /> : customers?.length ? <div className="dashboard-table-wrap"><table className="dashboard-table customers-table"><thead><tr><th>Customer</th><th>Wallet balance</th><th>Joined</th><th>Access</th></tr></thead><tbody>{customers.map((customer) => {
        const wallet = (wallets ?? []).find((item) => item.user_id === customer.id);
        return <tr key={customer.id}><td><div className="customer-identity"><span className="customer-avatar">{(customer.email ?? "?").slice(0, 1).toUpperCase()}</span><span><strong>{customer.email}</strong><small>{customer.id.slice(0, 8)}…</small></span></div></td><td>{walletsError ? <span>Unavailable</span> : wallet ? <strong>{(Number(wallet.balance_minor ?? 0) / 100).toFixed(2)} <em>{wallet.currency}</em></strong> : <span>No wallet record</span>}</td><td>{new Date(customer.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</td><td><span className={`customer-access ${customer.is_admin ? "is-admin" : ""}`}><i />{customer.is_admin ? "Admin" : "Customer"}</span></td></tr>;
      })}</tbody></table></div> : <AdminEmptyState message="No customers found. Try a different email address or clear the search." />}
      {!customersError && nextCursor && (
        <nav className="admin-pagination" aria-label="Customer pages">
          <div>
            <Link aria-label="Next customers page" href={`/admin/customers?${p.q ? `q=${encodeURIComponent(p.q)}&` : ""}cursor=${encodeURIComponent(nextCursor)}`}>Next →</Link>
          </div>
        </nav>
      )}
    </section>
  </div>;
}
