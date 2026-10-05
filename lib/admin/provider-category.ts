const CATEGORY_RULES: Record<string, { platform: string; terms: string[] }> = {
  "page-followers": { platform: "facebook", terms: ["page", "follower"] }, "page-likes": { platform: "facebook", terms: ["page", "like"] }, "post-likes": { platform: "facebook", terms: ["post", "like"] }, "video-views": { platform: "facebook", terms: ["video", "view"] }, reactions: { platform: "facebook", terms: ["reaction"] },
  followers: { platform: "instagram", terms: ["follower"] }, likes: { platform: "instagram", terms: ["like"] }, saves: { platform: "instagram", terms: ["save"] }, views: { platform: "instagram", terms: ["view"] },
};

export function providerCategoryForVantaSlug(slug: string) {
  const [platform, ...rest] = slug.toLowerCase().split("-");
  const metric = rest.join("-");
  const explicit = CATEGORY_RULES[metric];
  if (explicit && explicit.platform === platform) return explicit;
  const terms = metric.split("-").filter(Boolean).map((term) => term.endsWith("s") ? term.slice(0, -1) : term);
  return { platform, terms };
}

export function providerCatalogMatches(slug: string, name: string, category: string) {
  const rule = providerCategoryForVantaSlug(slug);
  const haystack = `${name} ${category}`.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return haystack.includes(rule.platform) && rule.terms.every((term) => haystack.includes(term));
}
