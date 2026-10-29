import Link from "next/link";
import { requireAdmin } from "../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../lib/supabase/server";
import { SyncCatalogButton } from "./SyncCatalogButton";
import { AdminEmptyState, AdminQueryError } from "../AdminDataState";
import { AdminFilterBar } from "../../../components/admin/AdminFilterBar";
import { parseProviderCatalogCursor } from "../../../lib/admin/cursor-validation";

export default async function ProviderCatalogPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; cursor?: string }> }) {
  const { admin } = await requireAdmin();
  if (!admin) return null;
  const params = await searchParams;
  const limit = 50;
  const queryText = (params.q ?? "").trim();
  const db = createSupabaseAdminClient();
  const isFiltered = Boolean(queryText || params.status);
  const countStrategy = isFiltered ? "exact" : "planned";

  // Keyset pagination on provider_service_id with validation
  let cursorServiceId: string | null = null;
  if (params.cursor) {
    try {
      cursorServiceId = parseProviderCatalogCursor(params.cursor);
    } catch {
      return (
        <div>
          <AdminQueryError message="The pagination cursor is malformed or invalid. Please return to the first page." />
          <Link href="/admin/provider-catalog" style={{ marginTop: "1rem", display: "inline-block" }}>← Return to start</Link>
        </div>
      );
    }
  }

  let query = db.from("provider_catalog_services")
    .select("provider,provider_service_id,name,provider_rate,provider_currency,rate_unit,min_quantity,max_quantity,refill_supported,cancel_supported,provider_status,last_synced_at", { count: countStrategy })
    .eq("provider", "reliablesmm");
  if (params.status) query = query.eq("provider_status", params.status);
  if (queryText) query = query.or(`provider_service_id.ilike.%${queryText}%,name.ilike.%${queryText}%`);
  if (cursorServiceId) query = query.gt("provider_service_id", cursorServiceId);
  const { data: services, count, error } = await query
    .order("provider_service_id")
    .limit(Math.min(limit, 100));

  // Build next cursor from the last row
  const hasNextPage = (services?.length ?? 0) === limit;
  const lastService = services?.at(-1);
  const nextCursor = hasNextPage && lastService ? lastService.provider_service_id : null;

  // Count display label
  const countLabel = count === null ? "unknown" : isFiltered ? `${count}` : `~${count}`;

  return <>
    <header className="dashboard-header"><p className="dashboard-kicker">PROVIDER CATALOG</p><h1>Imported services.</h1><p>Internal catalog only. Imported services are unpublished and never customer-visible by sync alone.</p></header>
    <SyncCatalogButton />
    <AdminFilterBar
      initialSearch={queryText}
      searchPlaceholder="Service ID or name"
      selects={[
        {
          name: "status",
          defaultValue: params.status ?? "",
          options: [
            { value: "", label: "All statuses" },
            { value: "ACTIVE", label: "ACTIVE" },
            { value: "STALE", label: "STALE" },
            { value: "INACTIVE", label: "INACTIVE" },
          ],
        },
      ]}
    />
    <div className="dashboard-card">
      {error ? <AdminQueryError message="Provider catalog could not be loaded. No empty-catalog result is being shown." /> : services?.length ? <>
        <div className="dashboard-table-wrap"><table className="dashboard-table"><thead><tr><th>ID</th><th>Name</th><th>Rate</th><th>Unit</th><th>Min / max</th><th>Refill</th><th>Cancel</th><th>Status</th><th>Synced</th></tr></thead><tbody>
          {services.map((service) => <tr key={`${service.provider}-${service.provider_service_id}`}><td>{service.provider_service_id}</td><td>{service.name}</td><td>{service.provider_rate} {service.provider_currency}</td><td>{service.rate_unit}</td><td>{service.min_quantity} / {service.max_quantity}</td><td>{service.refill_supported ? "Yes" : "No"}</td><td>{service.cancel_supported ? "Yes" : "No"}</td><td>{service.provider_status}</td><td>{new Date(service.last_synced_at).toLocaleString()}</td></tr>)}
        </tbody></table></div>
        <p>{countLabel} imported records{isFiltered ? " (filtered)" : " (approximate)"}</p>
        <div className="dashboard-actions">
          {cursorServiceId && <Link prefetch={false} href={`/admin/provider-catalog?q=${encodeURIComponent(queryText)}&status=${params.status ?? ""}`}>← First page</Link>}
          {nextCursor && <Link prefetch={false} href={`/admin/provider-catalog?q=${encodeURIComponent(queryText)}&status=${params.status ?? ""}&cursor=${encodeURIComponent(nextCursor)}`}>Next →</Link>}
        </div>
      </> : <AdminEmptyState message="No provider catalog records match these filters." />}
    </div>
  </>;
}
