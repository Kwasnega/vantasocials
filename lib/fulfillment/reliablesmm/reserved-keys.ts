export const RELIABLESMM_RESERVED_TRANSPORT_KEYS = new Set(["action", "service", "quantity", "link"]);

export function isReservedProviderTransportKey(key: string): boolean {
  return RELIABLESMM_RESERVED_TRANSPORT_KEYS.has(String(key).trim().toLowerCase());
}

export function assertAllowedProviderParameterKey(key: string): void {
  if (isReservedProviderTransportKey(key)) {
    throw new Error(`Provider parameter key '${key}' is reserved for system-controlled transport fields.`);
  }
}
