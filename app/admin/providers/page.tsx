import { requireAdmin } from "../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../lib/supabase/server";
import BalanceRefresh from "./BalanceRefresh";
import { AdminQueryError } from "../AdminDataState";

export default async function AdminProvidersPage() {
  const { admin } = await requireAdmin();
  if (!admin) return null;
  const db = createSupabaseAdminClient();
  const [
    { data: health, error: healthError },
    { count: catalogCount, error: catalogError },
    { data: latestSync, error: syncError },
  ] = await Promise.all([
    db.from("provider_health").select("provider,configured,balance,balance_currency,last_balance_check,balance_status,last_catalog_sync,catalog_count,last_error").eq("provider", "reliablesmm").maybeSingle(),
    db.from("provider_catalog_services").select("id", { count: "exact", head: true }).eq("provider", "reliablesmm"),
    db.from("provider_sync_runs").select("status,started_at,completed_at,imported_count,updated_count,failed_count").eq("provider", "reliablesmm").order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return <>
    <header className="dashboard-header"><p className="dashboard-kicker">INTEGRATIONS</p><h1>Providers.</h1><p>Read-only health display. Explicit refresh actions remain separate from page load.</p></header>
    <div className="dashboard-grid">
      <article className="dashboard-card">
        <strong>ReliableSMM</strong>
        {healthError ? <AdminQueryError message="Provider health could not be loaded; configuration and balance state are unknown." /> : <>
          <span>Configured: {health?.configured ? "Yes" : health ? "No" : "No health record"}</span>
          <span>Balance: {health?.balance ?? "Not checked"} {health?.balance_currency ?? ""}</span>
          <span>Balance status: {health?.balance_status ?? "Not checked"}</span>
          <span>Last balance check: {health?.last_balance_check ? new Date(health.last_balance_check).toLocaleString() : "—"}</span>
          <span>Last catalog sync: {health?.last_catalog_sync ? new Date(health.last_catalog_sync).toLocaleString() : "—"}</span>
          {health?.last_error && <span role="status">The last provider health operation reported an error.</span>}
        </>}
        {catalogError ? <AdminQueryError message="Provider catalog count could not be loaded." /> : <span>Catalog entries: {catalogCount ?? "Count unavailable"}</span>}
        {syncError ? <AdminQueryError message="Catalog sync status could not be loaded." /> : <span>Last sync: {latestSync ? `${latestSync.status} · ${new Date(latestSync.started_at).toLocaleString()}` : "No sync runs recorded"}</span>}
        {latestSync && !syncError && <span>Last sync imported {latestSync.imported_count}, updated {latestSync.updated_count}, failures {latestSync.failed_count}.</span>}
        <BalanceRefresh/><small>Fulfillment disabled; no provider write operations are exposed.</small>
      </article>
    </div>
  </>;
}
