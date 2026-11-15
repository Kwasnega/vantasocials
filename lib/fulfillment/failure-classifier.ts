/**
 * lib/fulfillment/failure-classifier.ts
 *
 * Pure, server-side classifier for ReliableSMM submission failures.
 * Maps raw errors/responses to structured failure reasons.
 */
import "server-only";
import { ReliableSMMError } from "./reliablesmm/client";

/** All valid failure reasons stored in orders.failure_reason */
export type OrderFailureReason =
  | "provider_insufficient_funds"
  | "provider_rejected"
  | "invalid_target"
  | "provider_timeout"
  | "provider_unreachable"
  | "internal_error"
  | "unknown";

export type FailureClassification = {
  reason: OrderFailureReason;
  detail: string;
};

/** Max length for failure_detail stored in DB (truncated if longer) */
const MAX_DETAIL_LENGTH = 500;

function truncate(s: string, max = MAX_DETAIL_LENGTH): string {
  if (s.length <= max) return s;
  return s.substring(0, max - 3) + "...";
}

function extractMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    if (typeof e.message === "string") return e.message;
    if (typeof e.error === "string") return e.error;
  }
  return String(error);
}

/**
 * Classify a provider failure from a thrown error or raw response object.
 *
 * ERROR STRING AUDIT (Verified vs Assumed):
 *
 * VERIFIED (Observed in ReliableSMM API documentation & production logs):
 *  - "Not enough balance on your account" -> provider_insufficient_funds
 *  - "Bad link" -> invalid_target
 *  - "Invalid link" -> invalid_target
 *  - "Link is private" / "private profile" -> invalid_target
 *  - "Incorrect request" -> provider_rejected
 *  - TimeoutError / AbortError / HTTP 408 -> provider_timeout
 *  - ECONNREFUSED / ENOTFOUND / EHOSTUNREACH -> provider_unreachable (Pre-connection error)
 *  - "fetch failed" with pre-connection causes -> provider_unreachable
 *
 * ASSUMED / UNVERIFIED (Treated as 'unknown' or 'provider_rejected' to require review):
 *  - Generic HTTP 502 / 503 / 504 (Server may have processed order before dying) -> classified as 'unknown' (needs review), NEVER auto-eligible
 *  - Any other unrecognized string -> 'unknown'
 */
export function classifyProviderFailure(error: unknown): FailureClassification {
  const message = extractMessage(error);
  const messageLower = message.toLowerCase();

  // 1. provider_timeout: AMBIGUOUS - order may exist at provider
  if (
    (error instanceof ReliableSMMError && error.code === "TIMEOUT") ||
    (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) ||
    /timeout|timed[\s_-]out|etimedout|408/i.test(messageLower)
  ) {
    return {
      reason: "provider_timeout",
      detail: truncate(`TIMEOUT: ${message}`),
    };
  }

  // 2. Pre-connection network errors (provably did NOT reach provider)
  // Limited strictly to DNS failure, connection refused, host unreachable.
  // Note: 502, 503, "fetch failed" without pre-connect causes are AMBIGUOUS.
  if (
    /econnrefused|ehostunreach|enotfound|getaddrinfo/i.test(messageLower)
  ) {
    return {
      reason: "provider_unreachable",
      detail: truncate(`NETWORK_PRECONNECT: ${message}`),
    };
  }

  // 3. provider_insufficient_funds: match balance/funds substrings case-insensitively
  if (
    /not enough balance|insufficient funds|insufficient balance|not enough funds|balance|insufficient/i.test(messageLower)
  ) {
    return {
      reason: "provider_insufficient_funds",
      detail: truncate(`INSUFFICIENT_FUNDS: ${message}`),
    };
  }

  // 4. invalid_target: bad link/url/private profile
  if (
    /invalid link|bad link|invalid url|invalid target|private profile|link is private|page not found/i.test(messageLower)
  ) {
    return {
      reason: "invalid_target",
      detail: truncate(`INVALID_TARGET: ${message}`),
    };
  }

  // 5. provider_rejected: explicit rejection returned by provider API
  if (
    (error instanceof ReliableSMMError && error.code === "PROVIDER_REJECTED") ||
    /incorrect request|service disabled|quantity is less|quantity is more/i.test(messageLower)
  ) {
    return {
      reason: "provider_rejected",
      detail: truncate(`REJECTED: ${message}`),
    };
  }

  // 6. internal_error: pre-provider errors (mapping, schema, DB)
  if (
    /mapping|schema|invalid quantity|eligibility|service_id|provider_service_id|inactive|not configured|missing api key|rate limit/i.test(messageLower)
  ) {
    return {
      reason: "internal_error",
      detail: truncate(`INTERNAL: ${message}`),
    };
  }

  // 7. All other errors (including HTTP 502/503/504, generic "fetch failed", or unhandled errors) -> 'unknown' (requires review)
  return {
    reason: "unknown",
    detail: truncate(`UNKNOWN: ${message}`),
  };
}
