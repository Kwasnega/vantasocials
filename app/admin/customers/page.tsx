import Link from "next/link";
import { requireAdmin } from "../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../lib/supabase/server";
import { AdminEmptyState, AdminQueryError } from "../AdminDataState";

export default async function AdminCustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { admin } = await requireAdmin();
  if (!admin) return null;
  const db = createSupabaseAdminClient();
  const p = await searchParams;
  const page = Math.max(1, Number.parseInt(p.page ?? "1", 10) || 1);
  const limit = 25;
  let query = db.from("profiles").select("id,email,is_admin,created_at", { count: "exact" });
  if (p.q?.trim()) query = query.ilike("email", `%${p.q.trim()}%`);
  const { data: customers, count, error: customersError } = await query.order("created_at", { ascending: false }).range((page - 1) * limit, page * limit - 1);
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
      <article><span>Total customers</span>{customersError ? <AdminQueryError message="Count unavailable." /> : <strong>{total ?? "Unavailable"}</strong>}<small>Registered accounts</small></article>
      <article><span>On this page</span>{customersError ? <AdminQueryError message="Count unavailable." /> : <strong>{customers?.length ?? 0}</strong>}<small>Showing latest first</small></article>
      <article><span>Admin access</span>{customersError ? <AdminQueryError message="Count unavailable." /> : <strong>{admins}</strong>}<small>Privileged accounts on this page</small></article>
      <article><span>Wallets shown</span>{customersError || walletsError ? <AdminQueryError message="Wallet balances unavailable." /> : <strong>{Object.entries(walletTotals).map(([currency, minor]) => `${(minor / 100).toFixed(2)} ${currency}`).join(" · ") || "0.00"}</strong>}<small>Current page only; not total liability</small></article>
    </section>

    <section className="customers-panel">
      <div className="customers-panel-heading"><div><p className="dashboard-kicker">CUSTOMER DIRECTORY</p><h2>All accounts</h2></div><span>{customersError ? "Count unavailable" : `${total ?? 0} records`}</span></div>
      <form className="customer-search"><label htmlFor="customer-search">Find a customer</label><div><span aria-hidden="true">⌕</span><input id="customer-search" name="q" defaultValue={p.q} placeholder="Search by email address"/><button type="submit">Search <b>↗</b></button></div></form>
      {customersError ? <AdminQueryError message="Customer records could not be loaded." /> : customers?.length ? <div className="dashboard-table-wrap"><table className="dashboard-table customers-table"><thead><tr><th>Customer</th><th>Wallet balance</th><th>Joined</th><th>Access</th></tr></thead><tbody>{customers.map((customer) => {
        const wallet = (wallets ?? []).find((item) => item.user_id === customer.id);
        return <tr key={customer.id}><td><div className="customer-identity"><span className="customer-avatar">{(customer.email ?? "?").slice(0, 1).toUpperCase()}</span><span><strong>{customer.email}</strong><small>{customer.id.slice(0, 8)}…</small></span></div></td><td>{walletsError ? <span>Unavailable</span> : wallet ? <strong>{(Number(wallet.balance_minor ?? 0) / 100).toFixed(2)} <em>{wallet.currency}</em></strong> : <span>No wallet record</span>}</td><td>{new Date(customer.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</td><td><span className={`customer-access ${customer.is_admin ? "is-admin" : ""}`}><i />{customer.is_admin ? "Admin" : "Customer"}</span></td></tr>;
      })}</tbody></table></div> : <AdminEmptyState message="No customers found. Try a different email address or clear the search." />}
      {!customersError && count !== null && <div className="customers-pagination"><span>Page {page} of {Math.max(1, Math.ceil((total ?? 0) / limit))}</span>{page > 1 || page < Math.max(1, Math.ceil((total ?? 0) / limit)) ? <div>{page > 1 && <Link href={`/admin/customers?q=${encodeURIComponent(p.q ?? "")}&page=${page - 1}`}>← Previous</Link>}{page < Math.max(1, Math.ceil((total ?? 0) / limit)) && <Link href={`/admin/customers?q=${encodeURIComponent(p.q ?? "")}&page=${page + 1}`}>Next →</Link>}</div> : <span>Up to date</span>}</div>}
    </section>
  </div>
}
