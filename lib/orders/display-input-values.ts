export function formatOrderInputValue(value: unknown): string {
  if (typeof value === "string") return value;

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const lines = (value as Record<string, unknown>).lines;
    if (Array.isArray(lines) && lines.every((line) => typeof line === "string")) {
      return lines.join("\n");
    }
    return JSON.stringify(value) ?? "";
  }

  if (Array.isArray(value)) return value.map(formatOrderInputValue).join(", ");
  return String(value);
}
