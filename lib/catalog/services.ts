import "server-only";
import { createSupabaseServerClient } from "../supabase/server";

export type CatalogService = { id: string; platform_id: string; name: string; slug: string; category: string; description: string | null; service_type: string; target_type: string; min_quantity: number; max_quantity: number; selling_rate: string; currency: string; active: boolean };

export async function getServices(platformSlug?: string): Promise<CatalogService[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("service_catalog").select("id,platform_id,name,slug,category,description,service_type,target_type,min_quantity,max_quantity,selling_rate,currency,active").order("name");
  if (platformSlug) {
    const { data: platform, error } = await supabase.from("platforms").select("id").eq("slug", platformSlug).eq("active", true).maybeSingle();
    if (error) throw error;
    if (!platform) return [];
    query = query.eq("platform_id", platform.id);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getService(slug: string): Promise<CatalogService | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("service_catalog").select("id,platform_id,name,slug,category,description,service_type,target_type,min_quantity,max_quantity,selling_rate,currency,active").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data;
}
