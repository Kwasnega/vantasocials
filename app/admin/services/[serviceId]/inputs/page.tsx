import Link from "next/link";
import { requireAdmin } from "../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";
import { ServiceInputConfiguration } from "./ServiceInputConfiguration";
import { AdminQueryError } from "../../../AdminDataState";

export default async function ServiceInputConfigurationPage({ params }: { params: Promise<{ serviceId: string }> }) {
  const { admin } = await requireAdmin();
  if (!admin) return null;
  const { serviceId } = await params;
  const db = createSupabaseAdminClient();
  const { data: service, error: serviceError } = await db.from("services").select("id,slug,name,active,target_type,platforms(name,slug)").eq("id", serviceId).maybeSingle();
  if (serviceError) return <AdminQueryError message="Service configuration could not be loaded." />;
  if (!service) return <div className="dashboard-card"><p className="dashboard-kicker">SERVICE</p><h1>Service not found.</h1><p>The configured VANTA service could not be found.</p><Link href="/admin/services">Back to services</Link></div>;
  const [
    { data: fields, error: fieldsError },
    { data: mappings, error: mappingsError },
    { data: catalog, error: catalogError },
  ] = await Promise.all([
    db.from("service_input_fields").select("id,service_id,key,label,input_type,required,display_order,placeholder,help_text,validation_config,active,schema_version,created_at,updated_at").eq("service_id", serviceId).order("display_order", { ascending: true }).order("created_at", { ascending: true }),
    db.from("service_provider_input_mappings").select("id,service_id,provider,provider_service_id,provider_parameter_key,transform_id,transform_version,provider_required,omit_when_blank,active,schema_version,vanta_input_field_key,created_at,updated_at").eq("service_id", serviceId).order("created_at", { ascending: false }),
    db.from("provider_catalog_services").select("provider,provider_service_id,name,provider_status,provider_rate,provider_currency,rate_unit,min_quantity,max_quantity,raw_metadata").eq("provider", "reliablesmm").eq("provider_status", "ACTIVE").order("provider_service_id"),
  ]);
  if (fieldsError || mappingsError || catalogError) return <>
    {fieldsError && <AdminQueryError message="Input fields could not be loaded." />}
    {mappingsError && <AdminQueryError message="Provider input mappings could not be loaded." />}
    {catalogError && <AdminQueryError message="Provider catalog candidates could not be loaded." />}
    <Link href="/admin/services">Back to services</Link>
  </>;
  return <ServiceInputConfiguration service={service as any} fields={(fields ?? []) as any[]} mappings={(mappings ?? []) as any[]} providerCatalog={(catalog ?? []) as any[]} />;
}
