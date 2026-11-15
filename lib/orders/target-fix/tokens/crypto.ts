import crypto from "node:crypto";

/**
 * Hash token using SHA-256 for secure DB persistence.
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Generate a cryptographically secure random base64url token (32 bytes).
 */
export function generateFixToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Constant-time string equality check to prevent timing attacks.
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
