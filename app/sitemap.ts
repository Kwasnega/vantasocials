import type { MetadataRoute } from "next";
import { createSupabaseAdminClient } from "../lib/supabase/server";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://vantasocials.com";

export const revalidate = 3600; // regenerate every hour

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const db = createSupabaseAdminClient();

  // Fetch active platform and service slugs in parallel
  const [{ data: platforms }, { data: services }] = await Promise.all([
    db
      .from("platforms")
      .select("slug, updated_at")
      .eq("active", true)
      .order("slug"),
    db
      .from("services")
      .select("slug, updated_at")
      .eq("active", true)
      .order("slug"),
  ]);

  const now = new Date().toISOString();

  // ── Static public pages ──────────────────────────────────────────────────────
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${BASE_URL}/`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/login`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/signup`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/contact`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/privacy-policy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/refund-policy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/terms`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  // ── Dynamic platform pages (/platforms/[platform]) ────────────────────────
  const platformPages: MetadataRoute.Sitemap = (platforms ?? []).map((p) => ({
    url: `${BASE_URL}/platforms/${p.slug}`,
    lastModified: p.updated_at ?? now,
    changeFrequency: "weekly" as const,
    priority: 0.9,
  }));

  // ── Dynamic service pages (/services/[service]) ──────────────────────────
  const servicePages: MetadataRoute.Sitemap = (services ?? []).map((s) => ({
    url: `${BASE_URL}/services/${s.slug}`,
    lastModified: s.updated_at ?? now,
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  return [...staticPages, ...platformPages, ...servicePages];
}
