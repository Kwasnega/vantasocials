import { requireAdmin } from "../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../lib/supabase/server";
import { AdminEmptyState, AdminQueryError } from "../AdminDataState";

export default async function AdminPlatformsPage() {
  const { admin } = await requireAdmin();
  if (!admin) return null;
  const db = createSupabaseAdminClient();
  const { data: platforms, error } = await db.from("platforms").select("slug,name,active,description").order("name");
  return <>
    <header className="dashboard-header"><p className="dashboard-kicker">CATALOG</p><h1>Platforms.</h1></header>
    {error ? <AdminQueryError message="Platform records could not be loaded." /> : platforms?.length ? (
      <div className="dashboard-grid">{platforms.map((platform) => <article className="dashboard-card" key={platform.slug}><strong>{platform.name}</strong><span>{platform.active ? "Active" : "Inactive"}</span><small>{platform.description}</small></article>)}</div>
    ) : <AdminEmptyState message="No platforms found." />}
  </>;
}
