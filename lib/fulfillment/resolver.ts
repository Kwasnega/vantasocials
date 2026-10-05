import "server-only";

import { createSupabaseAdminClient } from "../supabase/server";
import { ReliableSMMAdapter } from "./reliablesmm/adapter";

export async function resolveProviderForService(vantaSlug: string) {
  const db = createSupabaseAdminClient();
  const { data: service, error } = await db.from("services").select("provider,provider_service_id").eq("slug", vantaSlug).maybeSingle();
  if (error) throw error;
  if (!service?.provider || !service.provider_service_id) return null;
  if (service.provider !== "reliablesmm") return null;
  const { data: catalog, error: catalogError } = await db.from("provider_catalog_services").select("provider,provider_service_id,provider_currency,rate_unit,provider_status").eq("provider", "reliablesmm").eq("provider_service_id", service.provider_service_id).maybeSingle();
  if (catalogError) throw catalogError;
  if (!catalog || catalog.provider !== service.provider || catalog.provider_status !== "ACTIVE" || catalog.provider_currency !== "USD" || !["PER_1000", "PER_ORDER"].includes(catalog.rate_unit)) throw new Error("The service has no valid active ReliableSMM catalog mapping.");
  return { mapping: { provider: "reliablesmm" as const, vantaSlug, providerServiceId: service.provider_service_id, active: true, status: "ACTIVE" as const }, adapter: new ReliableSMMAdapter() };
}
