export const VANTA_INPUT_TYPES = ["username", "url", "post_url", "video_url", "channel", "page", "comments"] as const;
export type VantaInputType = typeof VANTA_INPUT_TYPES[number];
export type ValueShape = "scalar" | "comments";
export type ValidationRuleId = "username" | "url" | "post_url" | "video_url" | "channel" | "page" | "comments";
export type ValidationConfig = { maxLength?: number; maxLines?: number; maxLineLength?: number };
export type ServiceInputField = { key: string; label: string; inputType: VantaInputType; required: boolean; displayOrder: number; placeholder?: string; helpText?: string; validation: { rule: ValidationRuleId; config?: ValidationConfig }; schemaVersion: number; active: boolean };
export type ProviderInputMapping = { serviceId: string; vantaInputFieldKey: string; provider: string; providerServiceId: string; providerParameterKey: string; transform: { id: string; version: number }; providerRequired: boolean; omitWhenBlank: boolean; mappingSchemaVersion: number; active: boolean };
export type { CompatibilityState } from "../admin/provider-compatibility";
