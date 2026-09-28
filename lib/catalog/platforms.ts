import "server-only";
import { createSupabaseServerClient } from "../supabase/server";

export type CatalogPlatform = { id: string; slug: string; name: string; logo: string; color: string; description: string | null; active: boolean };

export async function getPlatforms(): Promise<CatalogPlatform[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("platforms").select("id,slug,name,logo,color,description,active").eq("active", true).order("name");
  if (error) throw error;
  return data;
}

export async function getPlatform(slug: string): Promise<CatalogPlatform | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("platforms").select("id,slug,name,logo,color,description,active").eq("slug", slug).eq("active", true).maybeSingle();
  if (error) throw error;
  return data;
}
