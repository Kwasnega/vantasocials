import Link from "next/link";
import { requireAdmin } from "../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";
import { ServiceInputConfiguration } from "./ServiceInputConfiguration";

export default async function ServiceInputConfigurationPage({ params }: { params: Promise<{ serviceId: string }> }) {
  const { admin } = await requireAdmin();
  if (!admin) return null;
  const { serviceId } = await params;
  const db = createSupabaseAdminClient();
  const { data: service } = await db.from("services").select("id,slug,name,active,target_type,platforms(name,slug)").eq("id", serviceId).maybeSingle();
  if (!service) return <div className="dashboard-card"><p className="dashboard-kicker">SERVICE</p><h1>Service not found.</h1><p>The configured VANTA service could not be found.</p><Link href="/admin/services">Back to services</Link></div>;
  const [{ data: fields }, { data: mappings }, { data: catalog }] = await Promise.all([
    db.from("service_input_fields").select("*").eq("service_id", serviceId).order("display_order", { ascending: true }).order("created_at", { ascending: true }),
    db.from("service_provider_input_mappings").select("*").eq("service_id", serviceId).order("created_at", { ascending: false }),
    db.from("provider_catalog_services").select("provider,provider_service_id,name,provider_status,raw_metadata").eq("provider", "reliablesmm").eq("provider_status", "ACTIVE").order("provider_service_id"),
  ]);
  return <ServiceInputConfiguration service={service as any} fields={(fields ?? []) as any[]} mappings={(mappings ?? []) as any[]} providerCatalog={(catalog ?? []) as any[]} />;
}
