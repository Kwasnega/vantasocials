import { RELIABLESMM_RESERVED_TRANSPORT_KEYS } from "./reserved-keys";

export type ReliableSMMRequestContext = {
  providerServiceId: string;
  quantity: number;
  targetValue: string;
  payload?: Record<string, unknown>;
};

export function buildReliableSMMProviderRequest({ providerServiceId, quantity, targetValue, payload = {} }: ReliableSMMRequestContext) {
  if (!providerServiceId || !Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error("ReliableSMM provider request is incomplete.");
  }

  const rawPayload = payload && typeof payload === "object" && !Array.isArray(payload) ? { ...payload } : {};
  const nextPayload: Record<string, string | number | boolean | undefined> = {};

  const internalRequestMetadataKeys = new Set([
    "provider",
    "providerServiceId",
    "provider_service_id",
    "provider_parameter_key",
    "providerParameterKey",
    "transform_id",
    "transformId",
    "transform_version",
    "transformVersion",
    "mapping_id",
    "mappingId",
    "omit_when_blank",
    "omitWhenBlank",
    "provider_required",
    "providerRequired",
  ]);

  const forbiddenRequestKeys = new Set([
    ...RELIABLESMM_RESERVED_TRANSPORT_KEYS,
    ...internalRequestMetadataKeys,
  ]);

  for (const [key, value] of Object.entries(rawPayload)) {
    if (forbiddenRequestKeys.has(key)) continue;
    if (value === undefined || value === null) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      nextPayload[key] = value;
      continue;
    }
    nextPayload[key] = String(value);
  }

  const nextTargetValue = typeof targetValue === "string" && targetValue.trim().length > 0 ? targetValue.trim() : typeof rawPayload.link === "string" && rawPayload.link.trim().length > 0 ? rawPayload.link.trim() : "";
  if (!nextTargetValue) throw new Error("ReliableSMM request is missing a target value.");

  const request = {
    service: Number(providerServiceId),
    quantity: Number(quantity),
    link: nextTargetValue,
    ...nextPayload,
  };

  return {
    providerServiceId,
    quantity: Number(quantity),
    targetValue: nextTargetValue,
    request,
  };
}
