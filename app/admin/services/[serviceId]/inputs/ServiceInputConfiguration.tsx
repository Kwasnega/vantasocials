"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { VANTA_INPUT_TYPES } from "../../../../lib/inputs/contracts";
import { TRANSFORM_REGISTRY } from "../../../../lib/inputs/transforms";
import { extractApprovedProviderParameters } from "../../../../lib/admin/service-input-config";

const fieldDefaults = {
  key: "",
  label: "",
  inputType: "url",
  required: true,
  displayOrder: 0,
  placeholder: "",
  helpText: "",
  validationConfig: { maxLength: 2048 },
  schemaVersion: 1,
  active: true,
};

const transformOptions = Object.values(TRANSFORM_REGISTRY).map((transform) => ({ id: transform.id, version: transform.version }));

export function ServiceInputConfiguration({ service, fields, mappings, providerCatalog }: { service: any; fields: any[]; mappings: any[]; providerCatalog: any[] }) {
  const [localFields, setLocalFields] = useState(fields);
  const [localMappings, setLocalMappings] = useState(mappings);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldForm, setFieldForm] = useState(fieldDefaults);
  const [mappingForm, setMappingForm] = useState({
    serviceInputFieldId: localFields[0]?.id ?? "",
    provider: "reliablesmm",
    providerServiceId: "",
    providerParameterKey: "",
    transformId: "normalize_url",
    transformVersion: 1,
    providerRequired: true,
    omitWhenBlank: false,
    schemaVersion: 1,
    active: true,
  });

  const catalogOptions = useMemo(() => providerCatalog.map((row) => ({
    ...row,
    parameterKeys: extractApprovedProviderParameters(row.raw_metadata),
  })), [providerCatalog]);

  const selectedCatalog = catalogOptions.find((row) => row.provider_service_id === mappingForm.providerServiceId) ?? null;

  async function submitField(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const response = await fetch(`/api/admin/services/${service.id}/input-fields`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...fieldForm,
        validationConfig: fieldForm.validationConfig,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.error ?? "Unable to save the field.");
      return;
    }
    const nextField = body.field;
    setLocalFields((current) => [...current, nextField].sort((a, b) => Number(a.display_order) - Number(b.display_order)));
    setFieldForm({ ...fieldDefaults, displayOrder: localFields.length, inputType: "url" });
    setMappingForm((current) => ({ ...current, serviceInputFieldId: nextField.id }));
    setMessage("Field created.");
  }

  async function toggleField(fieldId: string, active: boolean) {
    const response = await fetch(`/api/admin/services/${service.id}/input-fields/${fieldId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.error ?? "Unable to update the field.");
      return;
    }
    setLocalFields((current) => current.map((field) => field.id === fieldId ? { ...field, active } : field));
    setMessage(active ? "Field activated." : "Field deactivated.");
  }

  async function submitMapping(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const response = await fetch(`/api/admin/services/${service.id}/input-mappings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        serviceInputFieldId: mappingForm.serviceInputFieldId,
        provider: mappingForm.provider,
        providerServiceId: mappingForm.providerServiceId,
        providerParameterKey: mappingForm.providerParameterKey,
        transformId: mappingForm.transformId,
        transformVersion: mappingForm.transformVersion,
        providerRequired: mappingForm.providerRequired,
        omitWhenBlank: mappingForm.omitWhenBlank,
        schemaVersion: mappingForm.schemaVersion,
        active: mappingForm.active,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.error ?? "Unable to save the provider mapping.");
      return;
    }
    setLocalMappings((current) => [body.mapping, ...current.filter((mapping) => mapping.id !== body.mapping.id)]);
    setMessage("Provider mapping saved.");
  }

  async function toggleMapping(mappingId: string, active: boolean) {
    const response = await fetch(`/api/admin/services/${service.id}/input-mappings/${mappingId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.error ?? "Unable to update the mapping.");
      return;
    }
    setLocalMappings((current) => current.map((mapping) => mapping.id === mappingId ? { ...mapping, active } : mapping));
    setMessage(active ? "Mapping activated." : "Mapping deactivated.");
  }

  const fieldChoices = localFields.filter(Boolean);
  const hasProviderParameterChoices = Boolean(selectedCatalog && selectedCatalog.parameterKeys.length);

  return (
    <div className="dashboard-shell" style={{ display: "grid", gap: 18 }}>
      <header className="dashboard-header">
        <div>
          <p className="dashboard-kicker">ADMIN / SERVICE INPUTS</p>
          <h1>{service.name}</h1>
          <p>Configure VANTA customer fields and map them to approved ReliableSMM parameters.</p>
        </div>
        <Link href="/admin/services">Back to services</Link>
      </header>

      {message && <div className="dashboard-card"><p role="status">{message}</p></div>}

      <div className="dashboard-card">
        <h2>Add a VANTA input field</h2>
        <form onSubmit={submitField} style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <label>
              Key
              <input value={fieldForm.key} onChange={(event) => setFieldForm((current) => ({ ...current, key: event.target.value }))} required />
            </label>
            <label>
              Label
              <input value={fieldForm.label} onChange={(event) => setFieldForm((current) => ({ ...current, label: event.target.value }))} required />
            </label>
            <label>
              Input type
              <select value={fieldForm.inputType} onChange={(event) => setFieldForm((current) => ({ ...current, inputType: event.target.value }))}>
                {VANTA_INPUT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label>
              Display order
              <input type="number" min={0} value={fieldForm.displayOrder} onChange={(event) => setFieldForm((current) => ({ ...current, displayOrder: Number(event.target.value) || 0 }))} required />
            </label>
            <label>
              Placeholder
              <input value={fieldForm.placeholder} onChange={(event) => setFieldForm((current) => ({ ...current, placeholder: event.target.value }))} />
            </label>
            <label>
              Required
              <select value={fieldForm.required ? "true" : "false"} onChange={(event) => setFieldForm((current) => ({ ...current, required: event.target.value === "true" }))}>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
          </div>

          <label>
            Help text
            <textarea value={fieldForm.helpText} onChange={(event) => setFieldForm((current) => ({ ...current, helpText: event.target.value }))} rows={3} />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <label>
              Max length
              <input type="number" min={1} value={fieldForm.validationConfig.maxLength ?? ""} onChange={(event) => setFieldForm((current) => ({ ...current, validationConfig: { ...current.validationConfig, maxLength: Number(event.target.value) || undefined } }))} />
            </label>
            <label>
              Max lines
              <input type="number" min={1} value={fieldForm.validationConfig.maxLines ?? ""} onChange={(event) => setFieldForm((current) => ({ ...current, validationConfig: { ...current.validationConfig, maxLines: Number(event.target.value) || undefined } }))} />
            </label>
            <label>
              Max line length
              <input type="number" min={1} value={fieldForm.validationConfig.maxLineLength ?? ""} onChange={(event) => setFieldForm((current) => ({ ...current, validationConfig: { ...current.validationConfig, maxLineLength: Number(event.target.value) || undefined } }))} />
            </label>
          </div>

          <button type="submit" className="mapping-confirm">Save field</button>
        </form>
      </div>

      <div className="dashboard-card">
        <h2>Configured fields</h2>
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Label</th>
              <th>Type</th>
              <th>Required</th>
              <th>Order</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {localFields.length === 0 && <tr><td colSpan={7}>No fields configured yet.</td></tr>}
            {localFields.map((field) => (
              <tr key={field.id}>
                <td>{field.key}</td>
                <td>{field.label}</td>
                <td>{field.input_type}</td>
                <td>{field.required ? "Yes" : "No"}</td>
                <td>{field.display_order}</td>
                <td>{field.active ? "Active" : "Inactive"}</td>
                <td>
                  <button type="button" onClick={() => toggleField(field.id, !field.active)}>{field.active ? "Deactivate" : "Activate"}</button>
                  <button type="button" onClick={() => setMappingForm((current) => ({ ...current, serviceInputFieldId: field.id }))}>Map</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="dashboard-card">
        <h2>Provider mapping</h2>
        <form onSubmit={submitMapping} style={{ display: "grid", gap: 12 }}>
          <label>
            VANTA field
            <select value={mappingForm.serviceInputFieldId} onChange={(event) => setMappingForm((current) => ({ ...current, serviceInputFieldId: event.target.value }))}>
              {fieldChoices.map((field) => <option key={field.id} value={field.id}>{field.label} ({field.key})</option>)}
            </select>
          </label>

          <label>
            Provider service
            <select value={mappingForm.providerServiceId} onChange={(event) => setMappingForm((current) => ({ ...current, providerServiceId: event.target.value, providerParameterKey: "" }))}>
              <option value="">Select a ReliableSMM service</option>
              {catalogOptions.map((row) => (
                <option key={row.provider_service_id} value={row.provider_service_id}>{row.name} (#{row.provider_service_id})</option>
              ))}
            </select>
          </label>

          {selectedCatalog && (
            <div>
              <p>Provider: ReliableSMM</p>
              <p>Approved parameter keys: {selectedCatalog.parameterKeys.length ? selectedCatalog.parameterKeys.join(", ") : "Unavailable — provider metadata is not sufficient for a safe mapping."}</p>
            </div>
          )}

          {selectedCatalog && hasProviderParameterChoices && (
            <label>
              Provider parameter key
              <select value={mappingForm.providerParameterKey} onChange={(event) => setMappingForm((current) => ({ ...current, providerParameterKey: event.target.value }))}>
                <option value="">Select parameter</option>
                {selectedCatalog.parameterKeys.map((key: string) => <option key={key} value={key}>{key}</option>)}
              </select>
            </label>
          )}

          <label>
            Transform
            <select value={`${mappingForm.transformId}:${mappingForm.transformVersion}`} onChange={(event) => {
              const [id, version] = event.target.value.split(":");
              setMappingForm((current) => ({ ...current, transformId: id, transformVersion: Number(version) }));
            }}>
              {transformOptions.map((transform) => <option key={`${transform.id}:${transform.version}`} value={`${transform.id}:${transform.version}`}>{transform.id} v{transform.version}</option>)}
            </select>
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <label>
              Provider required
              <select value={mappingForm.providerRequired ? "true" : "false"} onChange={(event) => setMappingForm((current) => ({ ...current, providerRequired: event.target.value === "true" }))}>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
            <label>
              Omit when blank
              <select value={mappingForm.omitWhenBlank ? "true" : "false"} onChange={(event) => setMappingForm((current) => ({ ...current, omitWhenBlank: event.target.value === "true" }))}>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
            <label>
              Active
              <select value={mappingForm.active ? "true" : "false"} onChange={(event) => setMappingForm((current) => ({ ...current, active: event.target.value === "true" }))}>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
          </div>

          <button type="submit" className="mapping-confirm" disabled={!fieldChoices.length || !selectedCatalog || !hasProviderParameterChoices}>Save mapping</button>
        </form>
      </div>

      <div className="dashboard-card">
        <h2>Configured mappings</h2>
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Provider</th>
              <th>Service</th>
              <th>Parameter</th>
              <th>Transform</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {localMappings.length === 0 && <tr><td colSpan={7}>No provider mappings yet.</td></tr>}
            {localMappings.map((mapping) => (
              <tr key={mapping.id}>
                <td>{mapping.service_input_field_id}</td>
                <td>{mapping.provider}</td>
                <td>{mapping.provider_service_id}</td>
                <td>{mapping.provider_parameter_key}</td>
                <td>{mapping.transform_id} v{mapping.transform_version}</td>
                <td>{mapping.active ? "Active" : "Inactive"}</td>
                <td><button type="button" onClick={() => toggleMapping(mapping.id, !mapping.active)}>{mapping.active ? "Deactivate" : "Activate"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
