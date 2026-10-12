import { requireAdmin } from "../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../lib/supabase/server";
import { AdminEmptyState, AdminQueryError } from "../AdminDataState";

export default async function AdminPaymentsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const { admin } = await requireAdmin();
  if (!admin) return null;
  const db = createSupabaseAdminClient();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const limit = 25;
  let query = db.from("payments").select("reference,amount,currency,provider,status,paid_at,created_at,user_id,orders(public_order_id),profiles(email)", { count: "exact" });
  if (params.status) query = query.eq("status", params.status);
  if (params.q?.trim()) query = query.or(`reference.ilike.%${params.q.trim()}%`);
  const { data: payments, count, error } = await query.order("created_at", { ascending: false }).range((page - 1) * limit, page * limit - 1);
  const pages = count === null ? null : Math.max(1, Math.ceil(count / limit));
  return <>
    <header className="dashboard-header"><p className="dashboard-kicker">PAYMENTS</p><h1>Payments.</h1></header>
    <form className="dashboard-actions"><input name="q" defaultValue={params.q} placeholder="Payment or Paystack reference"/><select name="status" defaultValue={params.status ?? ""}><option value="">All statuses</option>{["PENDING", "PAID", "FAILED", "REFUNDED"].map((status) => <option key={status}>{status}</option>)}</select><button type="submit">Filter</button></form>
    <div className="dashboard-card">
      {error ? <AdminQueryError message="Payment records could not be loaded. No empty result is being shown." /> : payments?.length ? <>
        <div className="dashboard-table-wrap"><table className="dashboard-table"><thead><tr><th>Customer</th><th>Reference</th><th>Order</th><th>Amount</th><th>Provider</th><th>Status</th><th>Paid</th></tr></thead><tbody>
          {payments.map((payment) => <tr key={payment.reference}><td>{(payment.profiles as { email?: string } | null)?.email ?? "—"}</td><td>{payment.reference}</td><td>{(payment.orders as { public_order_id?: string } | null)?.public_order_id ?? "—"}</td><td>{payment.amount} {payment.currency}</td><td>{payment.provider}</td><td>{payment.status}</td><td>{payment.paid_at ? new Date(payment.paid_at).toLocaleString() : "—"}</td></tr>)}
        </tbody></table></div>
        <p>Page {page} of {pages ?? "unknown"} · {count ?? "unknown"} matching payments</p>
      </> : <AdminEmptyState message="No payments match these filters." />}
    </div>
  </>;
}
