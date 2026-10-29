import { requireAdmin } from "../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../lib/supabase/server";
import { AdminEmptyState, AdminQueryError } from "../AdminDataState";
import Link from "next/link";
import { parsePaymentCursor } from "../../../lib/admin/cursor-validation";

export default async function AdminPaymentsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; cursor?: string }> }) {
  const { admin } = await requireAdmin();
  if (!admin) return null;
  const db = createSupabaseAdminClient();
  const params = await searchParams;
  const limit = 25;

  // Keyset/cursor pagination with strict server-side validation
  let cursorCreatedAt: string | null = null;
  let cursorRef: string | null = null;
  if (params.cursor) {
    try {
      const validated = parsePaymentCursor(params.cursor);
      if (validated) {
        cursorCreatedAt = validated.createdAt;
        cursorRef = validated.id;
      }
    } catch {
      return (
        <div>
          <AdminQueryError message="The pagination cursor is malformed or invalid. Please return to the first page." />
          <Link href="/admin/payments" style={{ marginTop: "1rem", display: "inline-block" }}>← Return to start</Link>
        </div>
      );
    }
  }

  let query = db.from("payments").select("reference,amount,currency,provider,status,paid_at,created_at,user_id,orders(public_order_id),profiles(email)", { count: "exact" });
  if (params.status) query = query.eq("status", params.status);
  if (params.q?.trim()) query = query.or(`reference.ilike.%${params.q.trim()}%`);
  if (cursorCreatedAt && cursorRef) {
    query = query.or(`created_at.lt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},reference.lt.${cursorRef})`);
  }
  const { data: payments, count, error } = await query
    .order("created_at", { ascending: false })
    .order("reference", { ascending: false })
    .limit(Math.min(limit, 100));

  // Build next cursor
  const hasNextPage = (payments?.length ?? 0) === limit;
  const lastPayment = payments?.at(-1);
  const nextCursor = hasNextPage && lastPayment
    ? Buffer.from(JSON.stringify({ created_at: lastPayment.created_at, reference: lastPayment.reference })).toString("base64")
    : null;

  function buildHref(cursor?: string) {
    const p = new URLSearchParams();
    if (params.q) p.set("q", params.q);
    if (params.status) p.set("status", params.status);
    if (cursor) p.set("cursor", cursor);
    return `/admin/payments?${p.toString()}`;
  }

  return <>
    <header className="dashboard-header"><p className="dashboard-kicker">PAYMENTS</p><h1>Payments.</h1></header>
    <form className="dashboard-actions"><input name="q" defaultValue={params.q} placeholder="Payment or Paystack reference"/><select name="status" defaultValue={params.status ?? ""}><option value="">All statuses</option>{["PENDING", "PAID", "FAILED", "REFUNDED"].map((status) => <option key={status}>{status}</option>)}</select><button type="submit">Filter</button></form>
    <div className="dashboard-card">
      {error ? <AdminQueryError message="Payment records could not be loaded. No empty result is being shown." /> : payments?.length ? <>
        <div className="dashboard-table-wrap"><table className="dashboard-table"><thead><tr><th>Customer</th><th>Reference</th><th>Order</th><th>Amount</th><th>Provider</th><th>Status</th><th>Paid</th></tr></thead><tbody>
          {payments.map((payment) => <tr key={payment.reference}><td>{(payment.profiles as { email?: string } | null)?.email ?? "—"}</td><td>{payment.reference}</td><td>{(payment.orders as { public_order_id?: string } | null)?.public_order_id ?? "—"}</td><td>{payment.amount} {payment.currency}</td><td>{payment.provider}</td><td>{payment.status}</td><td>{payment.paid_at ? new Date(payment.paid_at).toLocaleString() : "—"}</td></tr>)}
        </tbody></table></div>
        <p>{count ?? "unknown"} matching payments</p>
        {nextCursor && (
          <nav className="admin-pagination" aria-label="Payment pages">
            <div>
              <Link href={buildHref(nextCursor)}>Next →</Link>
            </div>
          </nav>
        )}
      </> : <AdminEmptyState message="No payments match these filters." />}
    </div>
  </>;
}
