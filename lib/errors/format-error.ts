/**
 * Unified error formatter.
 * Ensures all caught errors, Postgres errors, and API objects are formatted
 * into readable diagnostic messages, never '[object Object]'.
 */
export function formatError(err: unknown): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err === "object") {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.details === "string") return obj.details;
    if (typeof obj.code === "string") return `Error code ${obj.code}: ${obj.message || "Operation failed"}`;
    try {
      return JSON.stringify(err);
    } catch {
      return "Internal error object";
    }
  }
  return String(err);
}
