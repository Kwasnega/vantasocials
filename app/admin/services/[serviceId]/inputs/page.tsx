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
  const { data: service, error: serviceError } = await db
    .from("services")
    .select("id,slug,name,active,target_type,provider,provider_service_id,platforms(name,slug)")
    .eq("id", serviceId)
    .maybeSingle();
  if (serviceError) return <AdminQueryError message="Service configuration could not be loaded." />;
  if (!service) return (
    <div className="dashboard-card">
      <p className="dashboard-kicker">SERVICE</p>
      <h1>Service not found.</h1>
      <p>The configured VANTA service could not be found.</p>
      <Link href="/admin/services">Back to services</Link>
    </div>
  );

  const [
    { data: fields, error: fieldsError },
    { data: mappings, error: mappingsError },
  ] = await Promise.all([
    db.from("service_input_fields")
      .select("id,service_id,key,label,input_type,required,display_order,placeholder,help_text,validation_config,active,schema_version,created_at,updated_at")
      .eq("service_id", serviceId)
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true }),
    db.from("service_provider_input_mappings")
      .select("id,service_id,service_input_field_id,provider,provider_service_id,provider_parameter_key,transform_id,transform_version,provider_required,omit_when_blank,schema_version,active,created_at,updated_at")
      .eq("service_id", serviceId)
      .order("created_at", { ascending: false }),
  ]);

  if (fieldsError) return <><AdminQueryError message="Input fields could not be loaded." /><Link href="/admin/services">Back to services</Link></>;
  if (mappingsError) return <><AdminQueryError message="Provider input mappings could not be loaded." /><Link href="/admin/services">Back to services</Link></>;

  // Load relevant provider catalog candidates:
  // 1. If service is already mapped to a provider service, fetch that exact service.
  // 2. Also load candidates matching the platform (or its aliases like x/twitter) so admin can select or re-map.
  let catalog: unknown[] = [];
  const mappedProviderServiceId = (service as { provider_service_id?: string | null }).provider_service_id;
  const platform = (service as { platforms?: { name?: string; slug?: string } | null }).platforms;
  const platformSlug = String(platform?.slug ?? "").toLowerCase();
  const platformName = String(platform?.name ?? "").toLowerCase();

  // Search keywords for the platform to match in provider catalog name/category
  const searchTerms = new Set<string>();
  if (platformName) searchTerms.add(platformName);
  if (platformSlug) searchTerms.add(platformSlug);

  // Platform specific aliases (e.g. X is called Twitter on ReliableSMM)
  if (platformSlug === "x" || platformName === "x") {
    searchTerms.add("twitter");
    searchTerms.add("tweet");
  } else if (platformSlug === "facebook" || platformName === "facebook") {
    searchTerms.add("fb");
  } else if (platformSlug === "instagram" || platformName === "instagram") {
    searchTerms.add("ig");
  } else if (platformSlug === "youtube" || platformName === "youtube") {
    searchTerms.add("yt");
  } else if (platformSlug === "telegram" || platformName === "telegram") {
    searchTerms.add("tg");
  }

  try {
    if (mappedProviderServiceId) {
      const { data: catalogRow } = await db
        .from("provider_catalog_services")
        .select("provider,provider_service_id,name,provider_status,provider_rate,provider_currency,rate_unit,min_quantity,max_quantity,raw_metadata")
        .eq("provider", "reliablesmm")
        .eq("provider_service_id", mappedProviderServiceId)
        .maybeSingle();
      if (catalogRow) catalog.push(catalogRow);
    }

    if (searchTerms.size > 0) {
      // Build an OR filter across all alias terms (e.g. name.ilike.%x%,name.ilike.%twitter%)
      const orFilter = Array.from(searchTerms)
        .map((term) => `name.ilike.%${term}%`)
        .join(",");

      let candidateQuery = db
        .from("provider_catalog_services")
        .select("provider,provider_service_id,name,provider_status,provider_rate,provider_currency,rate_unit,min_quantity,max_quantity,raw_metadata")
        .eq("provider", "reliablesmm")
        .eq("provider_status", "ACTIVE")
        .or(orFilter)
        .limit(200);

      if (mappedProviderServiceId) {
        candidateQuery = candidateQuery.neq("provider_service_id", mappedProviderServiceId);
      }

      const { data: candidates } = await candidateQuery;
      if (candidates && candidates.length) {
        catalog.push(...candidates);
      }
    }
  } catch (err) {
    console.warn("Failed to load catalog candidates for inputs page:", err);
  }

  return (
    <ServiceInputConfiguration
      service={service as any}
      fields={(fields ?? []) as any[]}
      mappings={(mappings ?? []) as any[]}
      providerCatalog={catalog as any[]}
    />
  );
}
