export const platformLogoUrls: Record<string, string> = {
  facebook: "https://cdn.simpleicons.org/facebook/1877F2",
  instagram: "https://cdn.simpleicons.org/instagram/E4405F",
  telegram: "https://cdn.simpleicons.org/telegram/26A5E4",
  tiktok: "https://cdn.simpleicons.org/tiktok/FFFFFF",
  youtube: "https://cdn.simpleicons.org/youtube/FF0000",
  x: "https://cdn.simpleicons.org/x/FFFFFF",
};

export function getPlatformLogoUrl(slugOrName: string) {
  return platformLogoUrls[slugOrName.toLowerCase()] ?? null;
}
