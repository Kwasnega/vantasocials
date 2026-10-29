export type TargetContract =
  | "INSTAGRAM_PROFILE"
  | "INSTAGRAM_CONTENT"
  | "INSTAGRAM_REEL"
  | "TIKTOK_PROFILE"
  | "TIKTOK_VIDEO"
  | "YOUTUBE_CHANNEL"
  | "YOUTUBE_VIDEO"
  | "FACEBOOK_PAGE"
  | "FACEBOOK_POST"
  | "FACEBOOK_VIDEO";

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
  "tiktok-followers": "TIKTOK_PROFILE",
  "tiktok-views": "TIKTOK_VIDEO",
  "tiktok-shares": "TIKTOK_VIDEO",
  "youtube-subscribers": "YOUTUBE_CHANNEL",
  "youtube-likes": "YOUTUBE_VIDEO",
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
};

export const getTargetContract = (slug: string) => legacyTargetContracts[slug] ?? null;

export function getTargetContractForService(input: {
  slug?: string;
  platformSlug?: string | null;
  targetType?: string | null;
}): TargetContract | null {
  const platform = String(input.platformSlug ?? "").trim().toLowerCase();
  const targetType = String(input.targetType ?? "").trim();

  if (platform === "instagram") {
    if (targetType === "username") return "INSTAGRAM_PROFILE";
    if (targetType === "url" || targetType === "post_url") return "INSTAGRAM_CONTENT";
    if (targetType === "video_url") return "INSTAGRAM_REEL";
  }
  if (platform === "tiktok") {
    if (targetType === "username") return "TIKTOK_PROFILE";
    if (targetType === "video_url") return "TIKTOK_VIDEO";
  }
  if (platform === "youtube") {
    if (targetType === "channel") return "YOUTUBE_CHANNEL";
    if (targetType === "video_url") return "YOUTUBE_VIDEO";
  }
  if (platform === "facebook") {
    if (targetType === "page") return "FACEBOOK_PAGE";
    if (targetType === "post_url") return "FACEBOOK_POST";
    if (targetType === "video_url") return "FACEBOOK_VIDEO";
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
    TIKTOK_PROFILE: ["tiktok.com", "www.tiktok.com"],
    TIKTOK_VIDEO: ["tiktok.com", "www.tiktok.com"],
    YOUTUBE_CHANNEL: ["youtube.com", "www.youtube.com"],
    YOUTUBE_VIDEO: ["youtube.com", "www.youtube.com", "youtu.be"],
    FACEBOOK_PAGE: ["facebook.com", "www.facebook.com", "m.facebook.com"],
    FACEBOOK_POST: ["facebook.com", "www.facebook.com", "m.facebook.com"],
    FACEBOOK_VIDEO: ["facebook.com", "www.facebook.com", "m.facebook.com"],
  };
  if (!allowedHosts[contract].includes(parsed.hostname)) {
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
    case "TIKTOK_PROFILE":
      matches = /^\/@[A-Za-z0-9._-]{1,24}\/?$/.test(path);
      break;
    case "TIKTOK_VIDEO":
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
