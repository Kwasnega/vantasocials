import { normalizeTargetForService, type TargetType } from "../../targets/contracts";

export type VantaTargetValidation = { valid: true; target: string } | { valid: false; reason: string };
export type ReliableSMMTarget = { link: string };

export function normalizeReliableSMMTarget(input: {
  platformSlug: string;
  targetType: TargetType;
  targetValue: string;
  transformId?: string;
  transformVersion?: number;
}): VantaTargetValidation {
  return normalizeTargetForService({
    platformSlug: input.platformSlug,
    targetType: input.targetType,
    value: input.targetValue,
    transformId: input.transformId,
    transformVersion: input.transformVersion,
  });
}

export function assertReliableSMMTarget(input: {
  platformSlug: string;
  targetType: TargetType;
  targetValue: string;
  transformId?: string;
  transformVersion?: number;
}): ReliableSMMTarget {
  const result = normalizeReliableSMMTarget(input);
  if (!result.valid) throw new Error(result.reason);
  return { link: result.target };
}
