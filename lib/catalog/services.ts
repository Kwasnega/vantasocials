import "server-only";
import { createSupabaseServerClient } from "../supabase/server";
import { normalizeInternalUnitRate } from "../pricing/customer-price";

export type CatalogService = { id: string; platform_id: string; name: string; slug: string; category: string; description: string | null; service_type: string; target_type: string; min_quantity: number; max_quantity: number; selling_rate: string; currency: string; active: boolean };
type CatalogServiceRow = Omit<CatalogService, "selling_rate"> & { selling_rate: string | number };

function normalizeCatalogService(row: CatalogServiceRow): CatalogService {
  return { ...row, selling_rate: normalizeInternalUnitRate(row.selling_rate) };
}

export async function getServices(platformSlug?: string): Promise<CatalogService[]> {
  const supabase = await createSupabaseServerClient();
  const { data: activePlatforms, error: platformsError } = await supabase
    .from("platforms")
    .select("id,slug")
    .eq("active", true);
  if (platformsError) throw platformsError;

  const platform = platformSlug
    ? (activePlatforms ?? []).find((item) => item.slug === platformSlug)
    : null;
  if (!platformSlug && !(activePlatforms ?? []).length) return [];

  let query = supabase.from("service_catalog").select("id,platform_id,name,slug,category,description,service_type,target_type,min_quantity,max_quantity,selling_rate,currency,active").order("name");
  if (platformSlug) {
    if (!platform) return [];
    query = query.eq("platform_id", platform.id);
  } else {
    query = query.in("platform_id", (activePlatforms ?? []).map((item) => item.id));
  }
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as CatalogServiceRow[]).map(normalizeCatalogService);
}

export async function getService(slug: string): Promise<CatalogService | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("service_catalog").select("id,platform_id,name,slug,category,description,service_type,target_type,min_quantity,max_quantity,selling_rate,currency,active").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data ? normalizeCatalogService(data as CatalogServiceRow) : null;
}
