export type HomepageCatalogPlatform = {
  id: string;
  slug: string;
  name: string;
  logo: string;
};

export type HomepageCatalogService = {
  platform_id: string;
  name: string;
  slug: string;
};

export type HomepageShowcaseService = {
  platformId: string;
  name: string;
  slug: string;
};

export type HomepageCatalogResponse = {
  platforms: HomepageCatalogPlatform[];
  services: HomepageCatalogService[];
};

export function groupHomepageServices(
  platforms: HomepageCatalogPlatform[],
  services: HomepageCatalogService[]
): Map<string, HomepageShowcaseService[]> {
  const platformSlugById = new Map(platforms.map((platform) => [platform.id, platform.slug]));
  const servicesByPlatform = new Map<string, HomepageShowcaseService[]>();

  for (const service of services) {
    const platformId = platformSlugById.get(service.platform_id);
    if (!platformId) continue;

    const grouped = servicesByPlatform.get(platformId) ?? [];
    grouped.push({ platformId, name: service.name, slug: service.slug });
    servicesByPlatform.set(platformId, grouped);
  }

  return servicesByPlatform;
}
