import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createSupabasePublicClient } from "../supabase/server";

export type CatalogPlatform = { id: string; slug: string; name: string; logo: string; color: string; description: string | null; active: boolean };

// Cross-request cache: revalidated by revalidateTag("catalog") after any admin write.
// TTL is 5 min as a safety net; tag-based invalidation is the primary mechanism.
const _fetchPlatforms = unstable_cache(
  async function _fetchPlatforms(): Promise<CatalogPlatform[]> {
    const supabase = createSupabasePublicClient();
    const { data, error } = await supabase.from("platforms").select("id,slug,name,logo,color,description,active").eq("active", true).order("name");
    if (error) throw error;
    return data;
  },
  ["catalog-platforms"],
  { revalidate: 300, tags: ["catalog"] },
);

const _fetchPlatform = unstable_cache(
  async function _fetchPlatform(slug: string): Promise<CatalogPlatform | null> {
    const supabase = createSupabasePublicClient();
    const { data, error } = await supabase.from("platforms").select("id,slug,name,logo,color,description,active").eq("slug", slug).eq("active", true).maybeSingle();
    if (error) throw error;
    return data;
  },
  ["catalog-platform"],
  { revalidate: 300, tags: ["catalog"] },
);

// Per-request deduplication on top of the cross-request cache.
export const getPlatforms = cache(async function getPlatforms(): Promise<CatalogPlatform[]> {
  return _fetchPlatforms();
});

export const getPlatform = cache(async function getPlatform(slug: string): Promise<CatalogPlatform | null> {
  return _fetchPlatform(slug);
});
