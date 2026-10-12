import "server-only";
import { createSupabaseServerClient } from "../supabase/server";
import type { HomepageCatalogResponse } from "./homepage-contract";

export async function getHomepageCatalog(): Promise<HomepageCatalogResponse> {
  const supabase = await createSupabaseServerClient();
  const [platformsResult, servicesResult] = await Promise.all([
    supabase
      .from("platforms")
      .select("id,slug,name,logo")
      .eq("active", true)
      .order("name"),
    supabase
      .from("service_catalog")
      .select("platform_id,name,slug")
      .order("name"),
  ]);

  if (platformsResult.error) throw platformsResult.error;
  if (servicesResult.error) throw servicesResult.error;

  const activePlatformIds = new Set((platformsResult.data ?? []).map((platform) => platform.id));
  return {
    platforms: platformsResult.data ?? [],
    services: (servicesResult.data ?? []).filter((service) => activePlatformIds.has(service.platform_id)),
  };
}
