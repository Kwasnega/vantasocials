import { requireAdmin } from "../../../lib/admin/auth";

export default async function AdminCustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { admin } = await requireAdmin();
  if (!admin) return null;
  const db = (await import("../../../lib/supabase/server")).createSupabaseAdminClient();
  const p = await searchParams;
  const page = Math.max(1, Number.parseInt(p.page ?? "1", 10) || 1);
  const limit = 25;
  let query = db.from("profiles").select("id,email,is_admin,created_at", { count: "exact" });
  if (p.q?.trim()) query = query.ilike("email", `%${p.q.trim()}%`);
  const { data: customers, count } = await query.order("created_at", { ascending: false }).range((page - 1) * limit, page * limit - 1);
  const wallets = customers?.length ? (await db.from("wallets").select("user_id,balance_minor").in("user_id", customers.map((x) => x.id))).data ?? [] : [];
  const total = count ?? 0;
  const admins = (customers ?? []).filter((customer) => customer.is_admin).length;
  const walletTotal = wallets.reduce((sum, wallet) => sum + Number(wallet.balance_minor ?? 0), 0) / 100;

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
      <article><span>Total customers</span><strong>{total}</strong><small>Registered accounts</small></article>
      <article><span>On this page</span><strong>{customers?.length ?? 0}</strong><small>Showing latest first</small></article>
      <article><span>Admin access</span><strong>{admins}</strong><small>Privileged accounts</small></article>
      <article><span>Wallets shown</span><strong>{walletTotal.toFixed(2)} <em>GHS</em></strong><small>Current page total</small></article>
    </section>

    <section className="customers-panel">
      <div className="customers-panel-heading"><div><p className="dashboard-kicker">CUSTOMER DIRECTORY</p><h2>All accounts</h2></div><span>{total} records</span></div>
      <form className="customer-search"><label htmlFor="customer-search">Find a customer</label><div><span aria-hidden="true">⌕</span><input id="customer-search" name="q" defaultValue={p.q} placeholder="Search by email address"/><button type="submit">Search <b>↗</b></button></div></form>
      <div className="dashboard-table-wrap"><table className="dashboard-table customers-table"><thead><tr><th>Customer</th><th>Wallet balance</th><th>Joined</th><th>Access</th></tr></thead><tbody>{(customers ?? []).map((customer) => <tr key={customer.id}><td><div className="customer-identity"><span className="customer-avatar">{(customer.email ?? "?").slice(0, 1).toUpperCase()}</span><span><strong>{customer.email}</strong><small>{customer.id.slice(0, 8)}…</small></span></div></td><td><strong>{(((wallets.find((w) => w.user_id === customer.id)?.balance_minor ?? 0) as number) / 100).toFixed(2)} <em>GHS</em></strong></td><td>{new Date(customer.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</td><td><span className={`customer-access ${customer.is_admin ? "is-admin" : ""}`}><i />{customer.is_admin ? "Admin" : "Customer"}</span></td></tr>)}</tbody></table></div>
      {(customers ?? []).length === 0 && <div className="customer-empty"><span>⌁</span><h3>No customers found</h3><p>Try a different email address or clear the search.</p></div>}
      <div className="customers-pagination"><span>Page {page} of {Math.max(1, Math.ceil(total / limit))}</span>{page > 1 || page < Math.max(1, Math.ceil(total / limit)) ? <div>{page > 1 && <a href={`/admin/customers?q=${encodeURIComponent(p.q ?? "")}&page=${page - 1}`}>← Previous</a>}{page < Math.max(1, Math.ceil(total / limit)) && <a href={`/admin/customers?q=${encodeURIComponent(p.q ?? "")}&page=${page + 1}`}>Next →</a>}</div> : <span>Up to date</span>}</div>
    </section>
  </div>
}
