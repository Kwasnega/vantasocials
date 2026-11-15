/**
 * Safe text sanitizer for oEmbed titles and author names.
 * - Strips any HTML tags (<script>, <a>, etc.)
 * - Unescapes basic HTML entities (&amp;, &#39;, &quot;, &lt;, &gt;)
 * - Removes control characters
 * - Truncates to maxChars (default 140)
 */
export function sanitizePreviewText(text: unknown, maxChars = 140): string {
  if (typeof text !== "string") return "";

  // Strip all HTML tags
  let cleaned = text.replace(/<[^>]*>/g, "");

  // Unescape standard HTML entities
  cleaned = cleaned
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

  // Remove control characters (except common whitespace)
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // Truncate
  if (cleaned.length > maxChars) {
    return cleaned.slice(0, maxChars).trim() + "…";
  }

  return cleaned;
}
