export type OrderExecutionMode = "LEGACY" | "DYNAMIC_VALID" | "DYNAMIC_INVALID";

export type DynamicOrderContract = {
  input_schema_version?: unknown;
  input_schema_snapshot?: unknown;
  input_values?: unknown;
};

const hasDynamicMetadata = (value: unknown) => value !== null && value !== undefined;

export function resolveOrderExecutionMode(order: DynamicOrderContract | null | undefined): OrderExecutionMode {
  if (!order) return "LEGACY";

  const { input_schema_version: version, input_schema_snapshot: snapshot, input_values: values } = order;
  const hasAnyDynamicMetadata = [version, snapshot, values].some(hasDynamicMetadata);
  if (!hasAnyDynamicMetadata) return "LEGACY";

  const hasCompleteDynamicMetadata = [version, snapshot, values].every(hasDynamicMetadata);
  if (!hasCompleteDynamicMetadata) return "DYNAMIC_INVALID";

  const validVersion = Number.isInteger(version) && Number(version) >= 1;
  const validSnapshot = Array.isArray(snapshot) && snapshot.length > 0 && snapshot.every((entry) => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry));
  const validValues = values !== null && typeof values === "object" && !Array.isArray(values) && Object.keys(values as Record<string, unknown>).length > 0;

  if (!validVersion || !validSnapshot || !validValues) return "DYNAMIC_INVALID";

  return "DYNAMIC_VALID";
}
