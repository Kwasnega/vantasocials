export const platformLogoUrls: Record<string, string> = {
  discord: "https://cdn.simpleicons.org/discord/5865F2",
  facebook: "https://cdn.simpleicons.org/facebook/1877F2",
  instagram: "https://cdn.simpleicons.org/instagram/E4405F",
  kick: "https://cdn.simpleicons.org/kick/53FC18",
  linkedin: "https://cdn.simpleicons.org/linkedin/0A66C2",
  pinterest: "https://cdn.simpleicons.org/pinterest/E60023",
  reddit: "https://cdn.simpleicons.org/reddit/FF4500",
  snapchat: "https://cdn.simpleicons.org/snapchat/FFFC00",
  soundcloud: "https://cdn.simpleicons.org/soundcloud/FF5500",
  spotify: "https://cdn.simpleicons.org/spotify/1DB954",
  telegram: "https://cdn.simpleicons.org/telegram/26A5E4",
  threads: "https://cdn.simpleicons.org/threads/FFFFFF",
  tiktok: "https://cdn.simpleicons.org/tiktok/FFFFFF",
  twitch: "https://cdn.simpleicons.org/twitch/9146FF",
  x: "https://cdn.simpleicons.org/x/FFFFFF",
  youtube: "https://cdn.simpleicons.org/youtube/FF0000",
};

export function getPlatformLogoUrl(slugOrName: string) {
  return platformLogoUrls[slugOrName.toLowerCase()] ?? null;
}
