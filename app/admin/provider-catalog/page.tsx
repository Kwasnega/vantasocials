import Link from "next/link";
import { requireAdmin } from "../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../lib/supabase/server";
import { SyncCatalogButton } from "./SyncCatalogButton";
import { AdminEmptyState, AdminQueryError } from "../AdminDataState";

export default async function ProviderCatalogPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const { admin } = await requireAdmin();
  if (!admin) return null;
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const limit = 50;
  const queryText = (params.q ?? "").trim();
  const db = createSupabaseAdminClient();
  let query = db.from("provider_catalog_services")
    .select("provider,provider_service_id,name,provider_rate,provider_currency,rate_unit,min_quantity,max_quantity,refill_supported,cancel_supported,provider_status,last_synced_at", { count: "exact" })
    .eq("provider", "reliablesmm");
  if (params.status) query = query.eq("provider_status", params.status);
  if (queryText) query = query.or(`provider_service_id.ilike.%${queryText}%,name.ilike.%${queryText}%`);
  const { data: services, count, error } = await query.order("provider_service_id").range((page - 1) * limit, page * limit - 1);
  const pages = count === null ? null : Math.max(1, Math.ceil(count / limit));

  return <>
    <header className="dashboard-header"><p className="dashboard-kicker">PROVIDER CATALOG</p><h1>Imported services.</h1><p>Internal catalog only. Imported services are unpublished and never customer-visible by sync alone.</p></header>
    <SyncCatalogButton />
    <form className="dashboard-actions"><input name="q" defaultValue={queryText} placeholder="Service ID or name"/><select name="status" defaultValue={params.status ?? ""}><option value="">All statuses</option><option>ACTIVE</option><option>STALE</option><option>INACTIVE</option></select><button type="submit">Filter</button></form>
    <div className="dashboard-card">
      {error ? <AdminQueryError message="Provider catalog could not be loaded. No empty-catalog result is being shown." /> : services?.length ? <>
        <div className="dashboard-table-wrap"><table className="dashboard-table"><thead><tr><th>ID</th><th>Name</th><th>Rate</th><th>Unit</th><th>Min / max</th><th>Refill</th><th>Cancel</th><th>Status</th><th>Synced</th></tr></thead><tbody>
          {services.map((service) => <tr key={`${service.provider}-${service.provider_service_id}`}><td>{service.provider_service_id}</td><td>{service.name}</td><td>{service.provider_rate} {service.provider_currency}</td><td>{service.rate_unit}</td><td>{service.min_quantity} / {service.max_quantity}</td><td>{service.refill_supported ? "Yes" : "No"}</td><td>{service.cancel_supported ? "Yes" : "No"}</td><td>{service.provider_status}</td><td>{new Date(service.last_synced_at).toLocaleString()}</td></tr>)}
        </tbody></table></div>
        <p>Page {page} of {pages ?? "unknown"} · {count ?? "unknown"} imported records</p>
        <div className="dashboard-actions">{page > 1 && <Link href={`/admin/provider-catalog?q=${encodeURIComponent(queryText)}&status=${params.status ?? ""}&page=${page - 1}`}>Previous</Link>}{pages !== null && page < pages && <Link href={`/admin/provider-catalog?q=${encodeURIComponent(queryText)}&status=${params.status ?? ""}&page=${page + 1}`}>Next</Link>}</div>
      </> : <AdminEmptyState message="No provider catalog records match these filters." />}
    </div>
  </>;
}
