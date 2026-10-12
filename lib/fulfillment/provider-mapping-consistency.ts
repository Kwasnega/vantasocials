export type ProviderMappingIdentity = {
  provider?: string | null;
  provider_service_id?: string | number | null;
};

export function assertProviderMappingConsistency(
  serviceMapping: ProviderMappingIdentity | null,
  inputMappings: ProviderMappingIdentity[],
) {
  const provider = serviceMapping?.provider?.trim();
  const providerServiceId = String(serviceMapping?.provider_service_id ?? "").trim();
  if (provider !== "reliablesmm" || !/^\d+$/.test(providerServiceId)) {
    throw new Error("Dynamic order has no valid service-level ReliableSMM mapping.");
  }
  if (inputMappings.length === 0) {
    throw new Error("Dynamic order is missing active provider input mappings.");
  }
  for (const mapping of inputMappings) {
    if (
      mapping.provider?.trim() !== provider ||
      String(mapping.provider_service_id ?? "").trim() !== providerServiceId
    ) {
      throw new Error("Dynamic input mapping provider identity does not match the service-level mapping.");
    }
  }
  return { provider, providerServiceId };
}
