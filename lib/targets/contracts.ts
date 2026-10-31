export type TargetContract =
  | "INSTAGRAM_PROFILE"
  | "INSTAGRAM_CONTENT"
  | "INSTAGRAM_REEL"
  | "INSTAGRAM_COMMENT"
  | "TIKTOK_PROFILE"
  | "TIKTOK_VIDEO"
  | "TIKTOK_COMMENT"
  | "YOUTUBE_CHANNEL"
  | "YOUTUBE_VIDEO"
  | "YOUTUBE_COMMENT"
  | "FACEBOOK_PAGE"
  | "FACEBOOK_POST"
  | "FACEBOOK_VIDEO"
  // Extended platform contracts — accept any valid HTTPS URL for the platform
  | "X_PROFILE"
  | "X_POST"
  | "LINKEDIN_PROFILE"
  | "LINKEDIN_POST"
  | "TELEGRAM_CHANNEL"
  | "TELEGRAM_POST"
  | "PINTEREST_PROFILE"
  | "PINTEREST_PIN"
  | "SPOTIFY_PROFILE"
  | "SPOTIFY_TRACK"
  | "TWITCH_CHANNEL"
  | "REDDIT_PROFILE"
  | "REDDIT_POST"
  | "SNAPCHAT_PROFILE"
  | "THREADS_PROFILE"
  | "THREADS_POST"
  | "GENERIC_PROFILE"
  | "GENERIC_URL";

export type ContractResult = { valid: true; target: string } | { valid: false; reason: string };
export type TargetType = "username" | "url" | "post_url" | "video_url" | "channel" | "page";
export type TargetRequirements = {
  contract: TargetContract;
  label: string;
  example: string;
  description: string;
};

const legacyTargetContracts: Record<string, TargetContract> = {
  "instagram-followers": "INSTAGRAM_PROFILE",
  "instagram-likes": "INSTAGRAM_CONTENT",
  "instagram-views": "INSTAGRAM_CONTENT",
  "instagram-saves": "INSTAGRAM_CONTENT",
  "instagram-comments": "INSTAGRAM_COMMENT",
  "tiktok-followers": "TIKTOK_PROFILE",
  "tiktok-views": "TIKTOK_VIDEO",
  "tiktok-shares": "TIKTOK_VIDEO",
  "tiktok-comments": "TIKTOK_COMMENT",
  "youtube-subscribers": "YOUTUBE_CHANNEL",
  "youtube-likes": "YOUTUBE_VIDEO",
  "youtube-comments": "YOUTUBE_COMMENT",
  "facebook-page-followers": "FACEBOOK_PAGE",
  "facebook-post-likes": "FACEBOOK_POST",
  "facebook-video-views": "FACEBOOK_VIDEO",
};

const requirements: Record<TargetContract, Omit<TargetRequirements, "contract">> = {
  INSTAGRAM_PROFILE: {
    label: "Instagram profile URL",
    example: "https://www.instagram.com/creator",
    description: "Use an Instagram profile link, not a post or reel link.",
  },
  INSTAGRAM_CONTENT: {
    label: "Instagram post or reel URL",
    example: "https://www.instagram.com/p/SHORTCODE or https://www.instagram.com/reel/SHORTCODE",
    description: "Use a direct Instagram post or reel link.",
  },
  INSTAGRAM_REEL: {
    label: "Instagram reel URL",
    example: "https://www.instagram.com/reel/SHORTCODE",
    description: "Use a direct Instagram reel link.",
  },
  INSTAGRAM_COMMENT: {
    label: "Instagram post URL",
    example: "https://www.instagram.com/p/SHORTCODE or https://www.instagram.com/reel/SHORTCODE",
    description: "Use a direct Instagram post or reel link to receive comments on.",
  },
  TIKTOK_PROFILE: {
    label: "TikTok profile URL",
    example: "https://www.tiktok.com/@creator",
    description: "Use a TikTok profile link, not a video link.",
  },
  TIKTOK_VIDEO: {
    label: "TikTok video URL",
    example: "https://www.tiktok.com/@creator/video/1234567890123456789",
    description: "Use a direct TikTok video link.",
  },
  TIKTOK_COMMENT: {
    label: "TikTok video URL",
    example: "https://www.tiktok.com/@creator/video/1234567890123456789",
    description: "Use a direct TikTok video link to receive comments on.",
  },
  YOUTUBE_CHANNEL: {
    label: "YouTube channel URL",
    example: "https://www.youtube.com/@creator",
    description: "Use a YouTube channel link, not a video link.",
  },
  YOUTUBE_VIDEO: {
    label: "YouTube video URL",
    example: "https://www.youtube.com/watch?v=VIDEO_ID or https://youtu.be/VIDEO_ID",
    description: "Use a YouTube watch, Shorts, or youtu.be video link.",
  },
  YOUTUBE_COMMENT: {
    label: "YouTube video URL",
    example: "https://www.youtube.com/watch?v=VIDEO_ID or https://youtu.be/VIDEO_ID",
    description: "Use a direct YouTube video link to receive comments on.",
  },
  FACEBOOK_PAGE: {
    label: "Facebook page URL",
    example: "https://www.facebook.com/page-name",
    description: "Use a Facebook page link, not a post or video link.",
  },
  FACEBOOK_POST: {
    label: "Facebook post URL",
    example: "https://www.facebook.com/page-name/posts/POST_ID",
    description: "Use a direct Facebook post link.",
  },
  FACEBOOK_VIDEO: {
    label: "Facebook video URL",
    example: "https://www.facebook.com/page-name/videos/VIDEO_ID",
    description: "Use a direct Facebook video or reel link.",
  },
  // ── Extended platform contracts ──────────────────────────────────────────
  X_PROFILE: {
    label: "X (Twitter) profile URL",
    example: "https://x.com/username",
    description: "Use an X (Twitter) profile link.",
  },
  X_POST: {
    label: "X (Twitter) post URL",
    example: "https://x.com/username/status/1234567890",
    description: "Use a direct X (Twitter) post link.",
  },
  LINKEDIN_PROFILE: {
    label: "LinkedIn profile or page URL",
    example: "https://www.linkedin.com/in/username",
    description: "Use a LinkedIn personal profile or company page link.",
  },
  LINKEDIN_POST: {
    label: "LinkedIn post URL",
    example: "https://www.linkedin.com/posts/username_activity-ID",
    description: "Use a direct LinkedIn post link.",
  },
  TELEGRAM_CHANNEL: {
    label: "Telegram channel URL",
    example: "https://t.me/channelname",
    description: "Use a public Telegram channel link.",
  },
  TELEGRAM_POST: {
    label: "Telegram post URL",
    example: "https://t.me/channelname/123",
    description: "Use a direct Telegram post link.",
  },
  PINTEREST_PROFILE: {
    label: "Pinterest profile URL",
    example: "https://www.pinterest.com/username",
    description: "Use a Pinterest profile link.",
  },
  PINTEREST_PIN: {
    label: "Pinterest pin URL",
    example: "https://www.pinterest.com/pin/PIN_ID",
    description: "Use a direct Pinterest pin link.",
  },
  SPOTIFY_PROFILE: {
    label: "Spotify artist or profile URL",
    example: "https://open.spotify.com/artist/ARTIST_ID",
    description: "Use a Spotify artist or profile link.",
  },
  SPOTIFY_TRACK: {
    label: "Spotify track URL",
    example: "https://open.spotify.com/track/TRACK_ID",
    description: "Use a direct Spotify track link.",
  },
  TWITCH_CHANNEL: {
    label: "Twitch channel URL",
    example: "https://www.twitch.tv/username",
    description: "Use a Twitch channel link.",
  },
  REDDIT_PROFILE: {
    label: "Reddit profile URL",
    example: "https://www.reddit.com/user/username",
    description: "Use a Reddit user profile link.",
  },
  REDDIT_POST: {
    label: "Reddit post URL",
    example: "https://www.reddit.com/r/subreddit/comments/POST_ID",
    description: "Use a direct Reddit post link.",
  },
  SNAPCHAT_PROFILE: {
    label: "Snapchat profile URL",
    example: "https://www.snapchat.com/add/username",
    description: "Use a Snapchat profile link.",
  },
  THREADS_PROFILE: {
    label: "Threads profile URL",
    example: "https://www.threads.net/@username",
    description: "Use a Threads profile link.",
  },
  THREADS_POST: {
    label: "Threads post URL",
    example: "https://www.threads.net/@username/post/POST_ID",
    description: "Use a direct Threads post link.",
  },
  GENERIC_PROFILE: {
    label: "Profile URL",
    example: "https://platform.com/username",
    description: "Use a valid HTTPS profile link for the platform.",
  },
  GENERIC_URL: {
    label: "Content URL",
    example: "https://platform.com/content/ID",
    description: "Use a valid HTTPS link to the content on the platform.",
  },
};

export const getTargetContract = (slug: string) => legacyTargetContracts[slug] ?? null;

export function getTargetContractForService(input: {
  slug?: string;
  platformSlug?: string | null;
  targetType?: string | null;
}): TargetContract | null {
  const platform = String(input.platformSlug ?? "").trim().toLowerCase();
  const targetType = String(input.targetType ?? "").trim();
  const slug = String(input.slug ?? "").trim().toLowerCase();

  // Comments services use post URL as the target for the post to comment on
  const isCommentSlug = slug.endsWith("-comments") || /comments/.test(slug);

  if (platform === "instagram") {
    if (targetType === "username") return "INSTAGRAM_PROFILE";
    if (targetType === "url" || targetType === "post_url") return isCommentSlug ? "INSTAGRAM_COMMENT" : "INSTAGRAM_CONTENT";
    if (targetType === "video_url") return "INSTAGRAM_REEL";
  }
  if (platform === "tiktok") {
    if (targetType === "username") return "TIKTOK_PROFILE";
    if (targetType === "url" || targetType === "post_url") return isCommentSlug ? "TIKTOK_COMMENT" : "TIKTOK_VIDEO";
    if (targetType === "video_url") return isCommentSlug ? "TIKTOK_COMMENT" : "TIKTOK_VIDEO";
  }
  if (platform === "youtube") {
    if (targetType === "channel") return "YOUTUBE_CHANNEL";
    if (targetType === "url" || targetType === "post_url" || targetType === "video_url") return isCommentSlug ? "YOUTUBE_COMMENT" : "YOUTUBE_VIDEO";
  }
  if (platform === "facebook") {
    if (targetType === "page") return "FACEBOOK_PAGE";
    if (targetType === "url" || targetType === "post_url") return "FACEBOOK_POST";
    if (targetType === "video_url") return "FACEBOOK_VIDEO";
  }
  // ── Extended platforms ───────────────────────────────────────────────────
  if (platform === "x" || platform === "twitter") {
    if (targetType === "username" || targetType === "url" || targetType === "post_url") {
      return isCommentSlug ? "X_POST" : targetType === "username" ? "X_PROFILE" : "X_POST";
    }
    // followers/profile services default to X_PROFILE
    return "X_PROFILE";
  }
  if (platform === "linkedin") {
    if (targetType === "username" || targetType === "url" || targetType === "post_url") {
      return isCommentSlug ? "LINKEDIN_POST" : targetType === "username" ? "LINKEDIN_PROFILE" : "LINKEDIN_POST";
    }
    return "LINKEDIN_PROFILE";
  }
  if (platform === "telegram") {
    if (targetType === "url" || targetType === "post_url") return "TELEGRAM_POST";
    // username/channel target → channel contract
    return "TELEGRAM_CHANNEL";
  }
  if (platform === "pinterest") {
    if (targetType === "url" || targetType === "post_url") return "PINTEREST_PIN";
    return "PINTEREST_PROFILE";
  }
  if (platform === "spotify") {
    if (targetType === "url" || targetType === "post_url") return "SPOTIFY_TRACK";
    return "SPOTIFY_PROFILE";
  }
  if (platform === "twitch") {
    return "TWITCH_CHANNEL";
  }
  if (platform === "reddit") {
    if (targetType === "url" || targetType === "post_url") return "REDDIT_POST";
    return "REDDIT_PROFILE";
  }
  if (platform === "snapchat") {
    return "SNAPCHAT_PROFILE";
  }
  if (platform === "threads") {
    if (targetType === "url" || targetType === "post_url") return "THREADS_POST";
    return "THREADS_PROFILE";
  }
  // ── Fallback: any known platform with any target type ───────────────────
  // Rather than returning null (which blocks service creation), return a
  // generic contract so the admin can always save their mapping.
  if (platform) {
    return targetType === "url" || targetType === "post_url" || targetType === "video_url"
      ? "GENERIC_URL"
      : "GENERIC_PROFILE";
  }
  return null;
}

export function getTargetRequirements(input: {
  platformSlug?: string | null;
  targetType?: string | null;
}): TargetRequirements | null {
  const contract = getTargetContractForService(input);
  return contract ? { contract, ...requirements[contract] } : null;
}

export function resolveTargetInputField<T extends { key: string; inputType?: string; input_type?: string }>(
  fields: T[],
  targetType: string,
): { field: T; error: null } | { field: null; error: string } {
  const compatibleTypes = targetType === "url" || targetType === "post_url"
    ? new Set(["url", "post_url"])
    : targetType === "username"
    ? new Set(["username", "url"])
    : new Set([targetType]);
  const matches = fields.filter((field) => compatibleTypes.has(String(field.inputType ?? field.input_type ?? "")));
  if (matches.length === 1) return { field: matches[0], error: null };
  if (matches.length === 0) return { field: null, error: "This service is missing a unique input field for its configured target type. Contact support." };
  return { field: null, error: "This service has multiple input fields for its configured target type. Contact support." };
}

const fail = (reason: string): ContractResult => ({ valid: false, reason });
const requirementError = (contract: TargetContract) =>
  `${requirements[contract].label} required. ${requirements[contract].description} Example: ${requirements[contract].example}`;

function parseHttpsUrl(value: string) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const trimmed = value.trim();
  if (trimmed.length > 2048 || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeIfConfigured(value: string, normalize: boolean): string {
  if (!normalize) return value.trim();
  const parsed = new URL(value.trim());
  parsed.hash = "";
  return parsed.toString();
}

function validPath(path: string, pattern: RegExp) {
  return pattern.test(path) || pattern.test(path.endsWith("/") ? path.slice(0, -1) : path);
}

function validateContract(contract: TargetContract, value: string, normalize: boolean): ContractResult {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fail(requirementError(contract));
  }

  const trimmed = value.trim();
  // Auto-prepend https:// if the user typed just the domain or path (e.g. "instagram.com/user" or "tiktok.com/@creator")
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  const parsed = parseHttpsUrl(withProtocol);
  if (!parsed) {
    return fail("Please enter a valid link or handle (e.g. https://instagram.com/username).");
  }

  return { valid: true, target: normalizeIfConfigured(withProtocol, normalize) };
}

export function normalizeTargetForService(input: {
  slug?: string;
  platformSlug?: string | null;
  targetType?: string | null;
  value: string;
  transformId?: string | null;
  transformVersion?: number | null;
}): ContractResult {
  const contract = getTargetContractForService(input);
  if (!contract) {
    return fail("This service has an unsupported or conflicting platform/target configuration. Contact support before ordering.");
  }
  if (input.transformId && (input.transformId !== "normalize_url" || input.transformVersion !== 1)) {
    return fail("The configured target URL transform is unsupported. Contact support before ordering.");
  }
  return validateContract(contract, input.value, input.transformId === "normalize_url" && input.transformVersion === 1);
}

export function validateConfiguredOrderTarget(input: {
  platformSlug?: string | null;
  targetType?: string | null;
  targetValue?: unknown;
  inputSchemaSnapshot?: unknown;
  inputValues?: unknown;
}): ContractResult {
  let value = input.targetValue;
  if (Array.isArray(input.inputSchemaSnapshot) && input.inputSchemaSnapshot.length > 0) {
    if (!input.inputValues || typeof input.inputValues !== "object" || Array.isArray(input.inputValues)) {
      return fail("The saved order is missing its configured target input.");
    }
    const targetField = resolveTargetInputField(
      input.inputSchemaSnapshot as Array<{ key: string; inputType?: string; input_type?: string }>,
      String(input.targetType ?? ""),
    );
    if (!targetField.field) return fail(targetField.error);
    value = (input.inputValues as Record<string, unknown>)[targetField.field.key];
  }
  if (typeof value !== "string") {
    const target = getTargetRequirements({ platformSlug: input.platformSlug, targetType: input.targetType });
    return fail(target ? `${target.description} Example: ${target.example}` : "This service has an unsupported or conflicting platform/target configuration.");
  }
  return normalizeTargetForService({
    platformSlug: input.platformSlug,
    targetType: input.targetType,
    value,
  });
}

const KNOWN_PLATFORM_HOSTS: Record<string, string[]> = {
  instagram: ["instagram.com", "www.instagram.com"],
  tiktok: ["tiktok.com", "www.tiktok.com"],
  youtube: ["youtube.com", "www.youtube.com", "youtu.be"],
  facebook: ["facebook.com", "www.facebook.com", "m.facebook.com", "fb.watch"],
  x: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
  twitter: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
  linkedin: ["linkedin.com", "www.linkedin.com"],
  telegram: ["t.me", "telegram.me"],
  pinterest: ["pinterest.com", "www.pinterest.com", "pinterest.co.uk", "www.pinterest.co.uk"],
  spotify: ["open.spotify.com", "spotify.com"],
  twitch: ["twitch.tv", "www.twitch.tv"],
  reddit: ["reddit.com", "www.reddit.com"],
  snapchat: ["snapchat.com", "www.snapchat.com"],
  threads: ["threads.net", "www.threads.net"],
};

export function checkTargetHostMatch(platformSlug: string | undefined | null, targetUrl: string): { matches: boolean; expectedHosts: string[] } {
  const normSlug = String(platformSlug ?? "").toLowerCase().trim();
  const hosts = KNOWN_PLATFORM_HOSTS[normSlug];
  if (!hosts || hosts.length === 0) return { matches: true, expectedHosts: [] };

  const trimmed = targetUrl.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    const hostname = url.hostname.toLowerCase();
    const isMatch = hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`));
    return { matches: isMatch, expectedHosts: hosts };
  } catch {
    return { matches: false, expectedHosts: hosts };
  }
}

export function effectiveQuantityBounds(vantaMin: number, vantaMax: number, providerMin: number, providerMax: number) {
  return { min: Math.max(vantaMin, providerMin), max: Math.min(vantaMax, providerMax) };
}
