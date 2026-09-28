export type TargetType = "username" | "url" | "channel" | "page";

export type Service = {
  id: string;
  slug: string;
  platformId: string;
  name: string;
  category: string;
  targetType: TargetType;
  minQuantity: number;
  maxQuantity: number;
  price: number;
  active: boolean;
};

export type Platform = {
  id: string;
  slug: string;
  name: string;
  logo: string;
  color: string;
  description: string;
  active: boolean;
};

export const platforms: Platform[] = [
  { id: "instagram", slug: "instagram", name: "Instagram", logo: "IG", color: "#df41ef", description: "Build momentum across your profile and posts.", active: true },
  { id: "tiktok", slug: "tiktok", name: "TikTok", logo: "TT", color: "#09a3f8", description: "Give your videos a stronger start.", active: true },
  { id: "youtube", slug: "youtube", name: "YouTube", logo: "YT", color: "#ff5b00", description: "Grow subscribers and video engagement.", active: true },
  { id: "facebook", slug: "facebook", name: "Facebook", logo: "f", color: "#099df4", description: "Support pages, posts, and video content.", active: true },
  { id: "x", slug: "x", name: "X", logo: "X", color: "#170529", description: "Build reach and engagement around your posts.", active: true },
  { id: "telegram", slug: "telegram", name: "Telegram", logo: "TG", color: "#089df4", description: "Grow channels and content visibility.", active: true },
];

const definitions: Record<string, Array<[string, string, TargetType]>> = {
  instagram: [["followers", "Followers", "username"], ["likes", "Likes", "url"], ["views", "Views", "url"], ["comments", "Comments", "url"], ["saves", "Saves", "url"]],
  tiktok: [["followers", "Followers", "username"], ["likes", "Likes", "url"], ["views", "Views", "url"], ["shares", "Shares", "url"], ["comments", "Comments", "url"]],
  youtube: [["subscribers", "Subscribers", "channel"], ["views", "Views", "url"], ["likes", "Likes", "url"], ["comments", "Comments", "url"]],
  facebook: [["page-followers", "Page followers", "page"], ["page-likes", "Page likes", "page"], ["post-likes", "Post likes", "url"], ["reactions", "Reactions", "url"], ["video-views", "Video views", "url"]],
  x: [["followers", "Followers", "username"], ["likes", "Likes", "url"], ["reposts", "Reposts", "url"], ["post-views", "Post views", "url"]],
  telegram: [["channel-members", "Channel members", "channel"], ["post-views", "Post views", "url"], ["reactions", "Reactions", "url"]],
};

export const services: Service[] = Object.entries(definitions).flatMap(([platformId, items]) => items.map(([slug, name, targetType]) => ({ id: `${platformId}-${slug}`, slug: `${platformId}-${slug}`, platformId, name, category: name, targetType, minQuantity: 100, maxQuantity: 100000, price: 0.01, active: true })));

export const getPlatforms = () => platforms.filter((platform) => platform.active);
export const getPlatform = (slug: string) => platforms.find((platform) => platform.slug === slug && platform.active);
export const getServices = () => services.filter((service) => service.active);
export const getService = (slug: string) => services.find((service) => service.slug === slug && service.active);
export const getServicesByPlatform = (platformId: string) => getServices().filter((service) => service.platformId === platformId);
