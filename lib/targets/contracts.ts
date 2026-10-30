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
    if (targetType === "url" || targetType === "post_url") return isCommentSlug ? "TIKTOK_COMMENT" : null;
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

  const parsed = parseHttpsUrl(value);
  if (!parsed) return fail(`Enter a valid ${requirements[contract].label.toLowerCase()} using HTTPS, without credentials, a custom port, or control characters.`);
  const allowedHosts: Record<TargetContract, string[]> = {
    INSTAGRAM_PROFILE: ["instagram.com", "www.instagram.com"],
    INSTAGRAM_CONTENT: ["instagram.com", "www.instagram.com"],
    INSTAGRAM_REEL: ["instagram.com", "www.instagram.com"],
    INSTAGRAM_COMMENT: ["instagram.com", "www.instagram.com"],
    TIKTOK_PROFILE: ["tiktok.com", "www.tiktok.com"],
    TIKTOK_VIDEO: ["tiktok.com", "www.tiktok.com"],
    TIKTOK_COMMENT: ["tiktok.com", "www.tiktok.com"],
    YOUTUBE_CHANNEL: ["youtube.com", "www.youtube.com"],
    YOUTUBE_VIDEO: ["youtube.com", "www.youtube.com", "youtu.be"],
    YOUTUBE_COMMENT: ["youtube.com", "www.youtube.com", "youtu.be"],
    FACEBOOK_PAGE: ["facebook.com", "www.facebook.com", "m.facebook.com"],
    FACEBOOK_POST: ["facebook.com", "www.facebook.com", "m.facebook.com"],
    FACEBOOK_VIDEO: ["facebook.com", "www.facebook.com", "m.facebook.com"],
    X_PROFILE: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
    X_POST: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
    LINKEDIN_PROFILE: ["linkedin.com", "www.linkedin.com"],
    LINKEDIN_POST: ["linkedin.com", "www.linkedin.com"],
    TELEGRAM_CHANNEL: ["t.me", "telegram.me"],
    TELEGRAM_POST: ["t.me", "telegram.me"],
    PINTEREST_PROFILE: ["pinterest.com", "www.pinterest.com", "pinterest.co.uk", "www.pinterest.co.uk"],
    PINTEREST_PIN: ["pinterest.com", "www.pinterest.com", "pinterest.co.uk", "www.pinterest.co.uk"],
    SPOTIFY_PROFILE: ["open.spotify.com"],
    SPOTIFY_TRACK: ["open.spotify.com"],
    TWITCH_CHANNEL: ["twitch.tv", "www.twitch.tv"],
    REDDIT_PROFILE: ["reddit.com", "www.reddit.com"],
    REDDIT_POST: ["reddit.com", "www.reddit.com"],
    SNAPCHAT_PROFILE: ["snapchat.com", "www.snapchat.com"],
    THREADS_PROFILE: ["threads.net", "www.threads.net"],
    THREADS_POST: ["threads.net", "www.threads.net"],
    // Generic contracts accept any host (validated below as a loose HTTPS URL)
    GENERIC_PROFILE: [],
    GENERIC_URL: [],
  };
  // For generic contracts, any HTTPS URL with a non-empty path is valid.
  // The allowedHosts list is empty, so we skip the host check and do a loose validation.
  if (contract === "GENERIC_PROFILE" || contract === "GENERIC_URL") {
    return parsed.pathname.length > 1
      ? { valid: true, target: normalizeIfConfigured(value, normalize) }
      : fail(requirementError(contract));
  }

  // For extended platform contracts, check the allowed hosts first.
  const hostList = allowedHosts[contract];
  if (!hostList.includes(parsed.hostname)) {
    return fail(requirementError(contract));
  }

  const path = parsed.pathname;
  let matches = false;
  switch (contract) {
    case "INSTAGRAM_PROFILE":
      matches = /^\/[A-Za-z0-9._]{1,30}\/?$/.test(path)
        && !new Set(["p", "reel", "reels", "stories", "accounts", "explore", "direct"]).has(path.split("/")[1].toLowerCase());
      break;
    case "INSTAGRAM_CONTENT":
      matches = /^\/(?:p|reel|reels)\/[A-Za-z0-9_-]+\/?$/.test(path);
      break;
    case "INSTAGRAM_REEL":
      matches = /^\/(?:reel|reels)\/[A-Za-z0-9_-]+\/?$/.test(path);
      break;
    case "INSTAGRAM_COMMENT":
      // Comments are posted on a specific post or reel — same URL pattern as INSTAGRAM_CONTENT
      matches = /^\/(?:p|reel|reels)\/[A-Za-z0-9_-]+\/?$/.test(path);
      break;
    case "TIKTOK_PROFILE":
      matches = /^\/@[A-Za-z0-9._-]{1,24}\/?$/.test(path);
      break;
    case "TIKTOK_VIDEO":
      matches = /^\/@[A-Za-z0-9._-]{1,24}\/video\/[0-9]{5,30}\/?$/.test(path);
      break;
    case "TIKTOK_COMMENT":
      // Comments are posted on a specific video — same URL pattern as TIKTOK_VIDEO
      matches = /^\/@[A-Za-z0-9._-]{1,24}\/video\/[0-9]{5,30}\/?$/.test(path);
      break;
    case "YOUTUBE_CHANNEL":
      matches = /^\/(?:channel\/[A-Za-z0-9_-]+|c\/[A-Za-z0-9._-]+|user\/[A-Za-z0-9._-]+|@[A-Za-z0-9._-]+)\/?$/.test(path);
      break;
    case "YOUTUBE_VIDEO": {
      const shortHost = parsed.hostname === "youtu.be";
      const idPattern = /^[A-Za-z0-9_-]{11}$/;
      if (shortHost) {
        matches = /^\/[A-Za-z0-9_-]{11}\/?$/.test(path);
      } else {
        const watchIds = parsed.searchParams.getAll("v");
        matches = (/^\/watch\/?$/.test(path) && watchIds.length === 1 && idPattern.test(watchIds[0]))
          || validPath(path, /^\/(?:shorts|embed)\/[A-Za-z0-9_-]{11}\/?$/);
      }
      break;
    }
    case "YOUTUBE_COMMENT": {
      // Comments are posted on a specific video — same URL pattern as YOUTUBE_VIDEO
      const shortHost = parsed.hostname === "youtu.be";
      const idPattern = /^[A-Za-z0-9_-]{11}$/;
      if (shortHost) {
        matches = /^\/[A-Za-z0-9_-]{11}\/?$/.test(path);
      } else {
        const watchIds = parsed.searchParams.getAll("v");
        matches = (/^\/watch\/?$/.test(path) && watchIds.length === 1 && idPattern.test(watchIds[0]))
          || validPath(path, /^\/(?:shorts|embed)\/[A-Za-z0-9_-]{11}\/?$/);
      }
      break;
    }
    case "FACEBOOK_PAGE":
      matches = /^\/[A-Za-z0-9._-]+\/?$/.test(path)
        && !new Set(["watch", "groups", "events", "login", "share", "reel", "videos"]).has(path.split("/")[1].toLowerCase());
      break;
    case "FACEBOOK_POST":
      matches = /^\/[A-Za-z0-9._-]+\/posts\/[A-Za-z0-9_-]+\/?$/.test(path)
        || (/^\/permalink\.php$/.test(path) && Boolean(parsed.searchParams.get("story_fbid")) && Boolean(parsed.searchParams.get("id")));
      break;
    case "FACEBOOK_VIDEO":
      matches = /^\/(?:[A-Za-z0-9._-]+\/)?videos\/[A-Za-z0-9_-]+\/?$/.test(path)
        || /^\/(?:reel|reels)\/[A-Za-z0-9_-]+\/?$/.test(path);
      break;
    // ── Extended platform contracts (loose path validation) ──────────────
    case "X_PROFILE":
      matches = /^\/[A-Za-z0-9_]{1,50}\/?$/.test(path)
        && !new Set(["i", "intent", "search", "explore", "settings", "home", "login"]).has(path.split("/")[1].toLowerCase());
      break;
    case "X_POST":
      matches = /^\/[A-Za-z0-9_]{1,50}\/status\/[0-9]+\/?$/.test(path);
      break;
    case "LINKEDIN_PROFILE":
      matches = /^\/(?:in|company|school)\/[A-Za-z0-9_%-]+\/?/.test(path);
      break;
    case "LINKEDIN_POST":
      matches = /^\/(?:posts|feed\/update)\//.test(path) || /^\/in\/[A-Za-z0-9_%-]+\//.test(path);
      break;
    case "TELEGRAM_CHANNEL":
      matches = /^\/[A-Za-z0-9_]{3,50}\/?$/.test(path);
      break;
    case "TELEGRAM_POST":
      matches = /^\/[A-Za-z0-9_]{3,50}\/[0-9]+\/?$/.test(path);
      break;
    case "PINTEREST_PROFILE":
      matches = /^\/[A-Za-z0-9_-]+\/?$/.test(path)
        && !new Set(["pin", "search", "explore", "ideas"]).has(path.split("/")[1].toLowerCase());
      break;
    case "PINTEREST_PIN":
      matches = /^\/pin\/[0-9]+\/?$/.test(path);
      break;
    case "SPOTIFY_PROFILE":
      matches = /^\/(?:artist|user|show)\/[A-Za-z0-9]+\/?$/.test(path);
      break;
    case "SPOTIFY_TRACK":
      matches = /^\/(?:track|episode|playlist|album)\/[A-Za-z0-9]+\/?$/.test(path);
      break;
    case "TWITCH_CHANNEL":
      matches = /^\/[A-Za-z0-9_]{3,50}\/?$/.test(path)
        && !new Set(["directory", "search", "subscriptions", "settings"]).has(path.split("/")[1].toLowerCase());
      break;
    case "REDDIT_PROFILE":
      matches = /^\/user\/[A-Za-z0-9_-]+\/?$/.test(path);
      break;
    case "REDDIT_POST":
      matches = /^\/r\/[A-Za-z0-9_]+\/comments\/[A-Za-z0-9_]+/.test(path);
      break;
    case "SNAPCHAT_PROFILE":
      matches = /^\/(?:add\/)?[A-Za-z0-9._-]{3,50}\/?$/.test(path);
      break;
    case "THREADS_PROFILE":
      matches = /^\/@[A-Za-z0-9._]{1,50}\/?$/.test(path);
      break;
    case "THREADS_POST":
      matches = /^\/@[A-Za-z0-9._]{1,50}\/post\/[A-Za-z0-9_-]+\/?$/.test(path);
      break;
  }

  if (!matches) return fail(requirementError(contract));
  return { valid: true, target: normalizeIfConfigured(value, normalize) };
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

export function effectiveQuantityBounds(vantaMin: number, vantaMax: number, providerMin: number, providerMax: number) {
  return { min: Math.max(vantaMin, providerMin), max: Math.min(vantaMax, providerMax) };
}
