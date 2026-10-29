export type ProviderInputMapping = {
  service_id: string;
  provider: string;
  provider_service_id: string;
  provider_parameter_key: string;
  transform_id: string;
  transform_version: number;
  provider_required: boolean;
  omit_when_blank: boolean;
  schema_version: number;
  active: boolean;
  vanta_input_field_key: string;
};

export type PersistedProviderInputMapping = Omit<ProviderInputMapping, "vanta_input_field_key"> & {
  service_input_fields: { key: string } | { key: string }[] | null;
};

export function normalizePersistedProviderInputMappings(
  mappings: PersistedProviderInputMapping[],
): ProviderInputMapping[] {
  return mappings.map(({ service_input_fields: relatedInputFields, ...mapping }) => {
    const inputField = Array.isArray(relatedInputFields)
      ? relatedInputFields.length === 1 ? relatedInputFields[0] : null
      : relatedInputFields;
    const key = inputField?.key.trim();
    if (!key) throw new Error("Provider input mapping is missing its VANTA input field.");
    return { ...mapping, vanta_input_field_key: key };
  });
}
