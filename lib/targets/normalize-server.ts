import {
  type TargetConfidence,
  type NormalizeTargetOptions,
  type NormalizeTargetResult,
  normalizeTarget,
  checkPlatformMismatch,
  PLATFORM_DOMAINS,
  PLATFORM_DISPLAY_NAMES,
} from "./normalize";

export {
  type TargetConfidence,
  type NormalizeTargetOptions,
  type NormalizeTargetResult,
  normalizeTarget,
  checkPlatformMismatch,
  PLATFORM_DOMAINS,
  PLATFORM_DISPLAY_NAMES,
};

export {
  isPrivateOrInternalIp,
  validateSafeHostname,
  resolveSafeRedirect,
  resolveTikTokShortLink,
  resolveFacebookShareLink,
} from "./redirect-resolver";

/**
 * Server-side target normalization that resolves short links via redirect-resolver.
 */
export async function normalizeTargetServer(
  options: NormalizeTargetOptions
): Promise<NormalizeTargetResult> {
  const { resolveTikTokShortLink, resolveFacebookShareLink } = await import("./redirect-resolver");
  return normalizeTarget(options, {
    resolveTikTok: resolveTikTokShortLink,
    resolveFacebook: resolveFacebookShareLink,
  });
}
