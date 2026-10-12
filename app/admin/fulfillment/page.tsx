import { requireAdmin } from "../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../lib/supabase/server";
import { AdminQueryError } from "../AdminDataState";

export default async function AdminFulfillmentPage() {
  const { admin } = await requireAdmin();
  if (!admin) return null;
  const db = createSupabaseAdminClient();
  const [pending, processing, unknown, failed, completed] = await Promise.all([
    db.from("provider_orders").select("id", { count: "exact", head: true }).in("status", ["NOT_STARTED", "SUBMITTING"]),
    db.from("provider_orders").select("id", { count: "exact", head: true }).in("status", ["SUBMITTED", "PROCESSING"]),
    db.from("provider_orders").select("id", { count: "exact", head: true }).eq("attempt_status", "UNKNOWN_PENDING_RECONCILIATION"),
    db.from("provider_orders").select("id", { count: "exact", head: true }).eq("status", "FAILED"),
    db.from("provider_orders").select("id", { count: "exact", head: true }).eq("status", "COMPLETED"),
  ]);
  const metrics = [
    ["Pending", pending],
    ["Submitted / processing", processing],
    ["Reconciliation", unknown],
    ["Failed", failed],
    ["Completed", completed],
  ] as const;
  return <>
    <header className="dashboard-header"><p className="dashboard-kicker">FULFILLMENT</p><h1>Fulfillment.</h1><p>Read-only operations view. Provider submission remains disabled.</p></header>
    <div className="dashboard-grid">{metrics.map(([label, result]) => <article className="dashboard-card" key={label}>
      <span>{label}</span>
      {result.error ? <AdminQueryError message={`${label} count unavailable.`} /> : <strong>{result.count ?? "Count unavailable"}</strong>}
    </article>)}</div>
  </>;
}
