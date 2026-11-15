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

  let query = db.from("profiles").select("id,email,is_admin,account_status,created_at", { count: countStrategy });
  if (p.q?.trim()) {
    const term = p.q.trim();
    // Allow searching by email or exact UUID
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(term)) {
      query = query.eq("id", term);
    } else {
      query = query.ilike("email", `%${term}%`);
    }
  }
  // Keyset filter: rows with created_at strictly before cursor, OR same created_at but id < cursorId
  if (cursorCreatedAt && cursorId) {
    query = query.or(`created_at.lt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.lt.${cursorId})`);
  }
  const { data: customers, count, error: customersError } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(Math.min(limit, 100));

  const customerIds = (customers ?? []).map((x) => x.id);

  const [
    { data: wallets, error: walletsError },
    { data: customerOrders },
    { data: openComplaints },
  ] = customerIds.length
    ? await Promise.all([
        db.from("wallets").select("user_id,balance_minor,currency").in("user_id", customerIds),
        db.from("orders").select("user_id,total,refund_amount,created_at,payment_status").in("user_id", customerIds),
        db.from("customer_notes").select("customer_id").in("customer_id", customerIds).eq("status", "open").eq("category", "complaint"),
      ])
    : [{ data: [], error: null }, { data: [] }, { data: [] }];

  // Compute spend (PAID orders only) and last order date (any order) per customer
  const spendByCustomer = new Map<string, number>();
  const lastOrderByCustomer = new Map<string, string>();
  (customerOrders || []).forEach((o) => {
    if (o.payment_status === "PAID") {
      const net = Number(o.total || 0) - Number(o.refund_amount || 0);
      spendByCustomer.set(o.user_id, (spendByCustomer.get(o.user_id) || 0) + net);
    }
    const existingDate = lastOrderByCustomer.get(o.user_id);
    if (!existingDate || new Date(o.created_at) > new Date(existingDate)) {
      lastOrderByCustomer.set(o.user_id, o.created_at);
    }
  });

  const openComplaintsSet = new Set((openComplaints || []).map((c) => c.customer_id));
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
      {customersError ? <AdminQueryError message="Customer records could not be loaded." /> : customers?.length ? <div className="dashboard-table-wrap"><table className="dashboard-table customers-table"><thead><tr><th>Customer</th><th>Wallet balance</th><th>Total spent</th><th>Last order</th><th>Status</th><th>Access</th><th>Actions</th></tr></thead><tbody>{customers.map((customer) => {
        const wallet = (wallets ?? []).find((item) => item.user_id === customer.id);
        const spent = spendByCustomer.get(customer.id) || 0;
        const lastOrder = lastOrderByCustomer.get(customer.id);
        const hasOpenComplaint = openComplaintsSet.has(customer.id);
        const status = (customer as { account_status?: string }).account_status || "ACTIVE";

        return <tr key={customer.id}>
          <td>
            <Link href={`/admin/customers/${customer.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              <div className="customer-identity">
                <span className="customer-avatar">{(customer.email ?? "?").slice(0, 1).toUpperCase()}</span>
                <span>
                  <strong>{customer.email}</strong>
                  <small>{customer.id.slice(0, 8)}…</small>
                  {hasOpenComplaint && (
                    <span style={{ fontSize: "10px", fontWeight: 700, padding: "1px 6px", borderRadius: "4px", backgroundColor: "rgba(245, 158, 11, 0.2)", color: "#fbbf24", marginLeft: "6px" }}>
                      Complaint Open
                    </span>
                  )}
                </span>
              </div>
            </Link>
          </td>
          <td>{walletsError ? <span>Unavailable</span> : wallet ? <strong>{(Number(wallet.balance_minor ?? 0) / 100).toFixed(2)} <em>{wallet.currency}</em></strong> : <span>No wallet record</span>}</td>
          <td><strong>GHS {spent.toFixed(2)}</strong></td>
          <td style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)" }}>{lastOrder ? new Date(lastOrder).toLocaleDateString() : "No orders"}</td>
          <td>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 600,
                padding: "2px 6px",
                borderRadius: "4px",
                backgroundColor: status === "SUSPENDED" ? "rgba(239, 68, 68, 0.2)" : status === "FLAGGED" ? "rgba(245, 158, 11, 0.2)" : "rgba(16, 185, 129, 0.2)",
                color: status === "SUSPENDED" ? "#ef4444" : status === "FLAGGED" ? "#f59e0b" : "#10b981",
              }}
            >
              {status}
            </span>
          </td>
          <td><span className={`customer-access ${customer.is_admin ? "is-admin" : ""}`}><i />{customer.is_admin ? "Admin" : "Customer"}</span></td>
          <td>
            <Link href={`/admin/customers/${customer.id}`} className="admin-row-action" style={{ fontSize: "12px", color: "#a5b4fc" }}>
              View profile →
            </Link>
          </td>
        </tr>;
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
