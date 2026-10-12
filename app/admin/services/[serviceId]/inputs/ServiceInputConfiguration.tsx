"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { VANTA_INPUT_TYPES } from "../../../../../lib/inputs/contracts";
import { TRANSFORM_REGISTRY } from "../../../../../lib/inputs/transforms";
import { extractApprovedProviderParameters } from "../../../../../lib/admin/service-input-config";

/* ─── Design tokens ─────────────────────────────────────────────── */
const inp: React.CSSProperties = {
  width: "100%", minHeight: "44px", padding: "0 14px",
  border: "1px solid #453052", borderRadius: "10px",
  background: "#21172d", color: "#f7f4fa",
  font: "inherit", fontSize: "14px", outline: "none",
};
const sel: React.CSSProperties = {
  ...inp, cursor: "pointer", appearance: "auto" as const,
};
const tex: React.CSSProperties = {
  ...inp, minHeight: "80px", padding: "10px 14px",
  resize: "vertical" as const, lineHeight: "1.5",
};
const lbl: React.CSSProperties = {
  display: "grid", gap: "6px", fontSize: "12px",
  fontWeight: 700, color: "#b7a9c0",
  textTransform: "uppercase", letterSpacing: ".08em",
};
const primaryBtn: React.CSSProperties = {
  padding: "12px 22px", border: "0", borderRadius: "10px",
  background: "#d883ff", color: "#170529", font: "inherit",
  fontSize: "13px", fontWeight: 800, cursor: "pointer",
  textTransform: "uppercase", letterSpacing: ".06em",
};
const ghostBtn: React.CSSProperties = {
  padding: "8px 14px", border: "1px solid #453052", borderRadius: "9px",
  background: "transparent", color: "#d883ff", font: "inherit",
  fontSize: "12px", fontWeight: 700, cursor: "pointer",
};

function Badge({ children, color = "#86f415", bg = "rgba(134,244,21,.1)" }: { children: React.ReactNode; color?: string; bg?: string }) {
  return (
    <span style={{ display: "inline-block", padding: "3px 9px", borderRadius: "6px", fontSize: "11px", fontWeight: 700, color, background: bg, letterSpacing: ".05em", textTransform: "uppercase" }}>
      {children}
    </span>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ padding: "24px", border: "1px solid #352244", borderRadius: "18px", background: "#1b0b28", ...style }}>
      {children}
    </div>
  );
}

const fieldDefaults = {
  key: "", label: "", inputType: "url", required: true,
  displayOrder: 0, placeholder: "", helpText: "",
  validationConfig: { maxLength: 2048 } as { maxLength?: number; maxLines?: number; maxLineLength?: number },
  schemaVersion: 1, active: true,
};

const transformOptions = Object.values(TRANSFORM_REGISTRY).map((t) => ({ id: t.id, version: t.version }));

export function ServiceInputConfiguration({
  service, fields, mappings, providerCatalog,
}: {
  service: any; fields: any[]; mappings: any[]; providerCatalog: any[];
}) {
  const [localFields, setLocalFields] = useState(fields);
  const [localMappings, setLocalMappings] = useState(mappings);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [fieldForm, setFieldForm] = useState(fieldDefaults);
  const [mappingForm, setMappingForm] = useState({
    serviceInputFieldId: fields[0]?.id ?? "",
    provider: "reliablesmm", providerServiceId: "",
    providerParameterKey: "", transformId: "normalize_url",
    transformVersion: 1, providerRequired: true,
    omitWhenBlank: false, schemaVersion: 1, active: true,
  });

  const catalogOptions = useMemo(() =>
    providerCatalog.map((row) => ({ ...row, parameterKeys: extractApprovedProviderParameters(row.raw_metadata) })),
    [providerCatalog]
  );

  const selectedCatalog = catalogOptions.find((r) => r.provider_service_id === mappingForm.providerServiceId) ?? null;
  const fieldChoices = localFields.filter(Boolean);
  const hasParams = Boolean(selectedCatalog && selectedCatalog.parameterKeys.length);

  function notify(text: string, ok = true) {
    setToast({ text, ok });
    setTimeout(() => setToast(null), 4000);
  }

  async function submitField(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const r = await fetch(`/api/admin/services/${service.id}/input-fields`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...fieldForm }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { notify(body.error ?? "Unable to save field.", false); return; }
    setLocalFields((c) => [...c, body.field].sort((a, b) => Number(a.display_order) - Number(b.display_order)));
    setFieldForm({ ...fieldDefaults, displayOrder: localFields.length, inputType: "url" });
    setMappingForm((c) => ({ ...c, serviceInputFieldId: body.field.id }));
    notify("Field created.");
  }

  async function toggleField(id: string, active: boolean) {
    const r = await fetch(`/api/admin/services/${service.id}/input-fields/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ active }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { notify(body.error ?? "Unable to update field.", false); return; }
    setLocalFields((c) => c.map((f) => f.id === id ? { ...f, active } : f));
    notify(active ? "Field activated." : "Field deactivated.");
  }

  async function submitMapping(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const r = await fetch(`/api/admin/services/${service.id}/input-mappings`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        serviceInputFieldId: mappingForm.serviceInputFieldId,
        provider: mappingForm.provider, providerServiceId: mappingForm.providerServiceId,
        providerParameterKey: mappingForm.providerParameterKey,
        transformId: mappingForm.transformId, transformVersion: mappingForm.transformVersion,
        providerRequired: mappingForm.providerRequired, omitWhenBlank: mappingForm.omitWhenBlank,
        schemaVersion: mappingForm.schemaVersion, active: mappingForm.active,
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { notify(body.error ?? "Unable to save mapping.", false); return; }
    setLocalMappings((c) => [body.mapping, ...c.filter((m) => m.id !== body.mapping.id)]);
    notify("Mapping saved.");
  }

  async function toggleMapping(id: string, active: boolean) {
    const r = await fetch(`/api/admin/services/${service.id}/input-mappings/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ active }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { notify(body.error ?? "Unable to update mapping.", false); return; }
    setLocalMappings((c) => c.map((m) => m.id === id ? { ...m, active } : m));
    notify(active ? "Mapping activated." : "Mapping deactivated.");
  }

  const platform = service?.platforms;

  return (
    <>
      {/* ── Header ── */}
      <div style={{ marginBottom: "8px" }}>
        <Link href="/admin/services" style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: "#b7a9c0", fontSize: "13px", fontWeight: 700, marginBottom: "18px" }}>
          ← Back to Services
        </Link>
        <p className="dashboard-kicker">ADMIN / SERVICE INPUTS</p>
        <h1 style={{ margin: "6px 0 8px", color: "#fff", fontFamily: "Oswald, Impact, sans-serif", fontSize: "clamp(38px, 4vw, 62px)", letterSpacing: "-.04em", textTransform: "uppercase", textShadow: "none", lineHeight: 1 }}>
          {service.name}
        </h1>
        {platform && (
          <p style={{ margin: "0 0 4px", color: "#a99bb2", fontSize: "13px" }}>
            Platform: <strong style={{ color: "#d883ff" }}>{platform.name}</strong>
          </p>
        )}
        <p style={{ margin: 0, color: "#b7a9c0", fontSize: "14px", lineHeight: 1.5 }}>
          Define what customers fill out and map each field to the ReliableSMM API parameter.
        </p>
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div style={{ padding: "12px 16px", borderRadius: "10px", margin: "16px 0", fontSize: "14px", fontWeight: 600, background: toast.ok ? "rgba(134,244,21,.1)" : "rgba(255,113,136,.1)", border: `1px solid ${toast.ok ? "rgba(134,244,21,.3)" : "rgba(255,113,136,.35)"}`, color: toast.ok ? "#86f415" : "#ff9baa" }}>
          {toast.ok ? "✓ " : "✕ "}{toast.text}
        </div>
      )}

      {/* ── Step 1 + Step 2 side by side ── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: "18px", alignItems: "start", marginTop: "20px" }}>

        {/* STEP 1 — Add field */}
        <Card>
          <p className="dashboard-kicker" style={{ margin: "0 0 4px" }}>Step 1</p>
          <h2 style={{ margin: "0 0 6px", color: "#fff", fontSize: "18px", fontWeight: 800 }}>Add a VANTA Input Field</h2>
          <p style={{ margin: "0 0 20px", color: "#8f8099", fontSize: "13px" }}>Define what the customer fills out on the order form.</p>

          <form onSubmit={submitField} style={{ display: "grid", gap: "14px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <label style={lbl}>
                Key (internal)
                <input style={inp} value={fieldForm.key} placeholder="e.g. profile_url" required
                  onChange={(e) => setFieldForm((c) => ({ ...c, key: e.target.value }))} />
              </label>
              <label style={lbl}>
                Label (visible to customer)
                <input style={inp} value={fieldForm.label} placeholder="e.g. Profile URL" required
                  onChange={(e) => setFieldForm((c) => ({ ...c, label: e.target.value }))} />
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
              <label style={lbl}>
                Input type
                <select style={sel} value={fieldForm.inputType}
                  onChange={(e) => setFieldForm((c) => ({ ...c, inputType: e.target.value }))}>
                  {VANTA_INPUT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label style={lbl}>
                Required
                <select style={sel} value={fieldForm.required ? "true" : "false"}
                  onChange={(e) => setFieldForm((c) => ({ ...c, required: e.target.value === "true" }))}>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </label>
              <label style={lbl}>
                Display order
                <input style={inp} type="number" min={0} value={fieldForm.displayOrder} required
                  onChange={(e) => setFieldForm((c) => ({ ...c, displayOrder: Number(e.target.value) || 0 }))} />
              </label>
            </div>

            <label style={lbl}>
              Placeholder text
              <input style={inp} value={fieldForm.placeholder} placeholder="e.g. https://instagram.com/yourprofile"
                onChange={(e) => setFieldForm((c) => ({ ...c, placeholder: e.target.value }))} />
            </label>

            <label style={lbl}>
              Help text (shown below input)
              <textarea style={tex} value={fieldForm.helpText} placeholder="e.g. Enter your full Instagram profile URL" rows={3}
                onChange={(e) => setFieldForm((c) => ({ ...c, helpText: e.target.value }))} />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
              <label style={lbl}>
                Max length
                <input style={inp} type="number" min={1} value={fieldForm.validationConfig.maxLength ?? ""}
                  onChange={(e) => setFieldForm((c) => ({ ...c, validationConfig: { ...c.validationConfig, maxLength: Number(e.target.value) || undefined } }))} />
              </label>
              <label style={lbl}>
                Max lines
                <input style={inp} type="number" min={1} value={fieldForm.validationConfig.maxLines ?? ""}
                  onChange={(e) => setFieldForm((c) => ({ ...c, validationConfig: { ...c.validationConfig, maxLines: Number(e.target.value) || undefined } }))} />
              </label>
              <label style={lbl}>
                Max line length
                <input style={inp} type="number" min={1} value={fieldForm.validationConfig.maxLineLength ?? ""}
                  onChange={(e) => setFieldForm((c) => ({ ...c, validationConfig: { ...c.validationConfig, maxLineLength: Number(e.target.value) || undefined } }))} />
              </label>
            </div>

            <button type="submit" style={primaryBtn}>+ Save Field</button>
          </form>
        </Card>

        {/* STEP 2 — Provider mapping */}
        <Card>
          <p className="dashboard-kicker" style={{ margin: "0 0 4px" }}>Step 2</p>
          <h2 style={{ margin: "0 0 6px", color: "#fff", fontSize: "18px", fontWeight: 800 }}>Provider Mapping</h2>
          <p style={{ margin: "0 0 20px", color: "#8f8099", fontSize: "13px" }}>Map a VANTA field to the exact ReliableSMM API parameter it should send.</p>

          {fieldChoices.length === 0 ? (
            <div style={{ padding: "24px", borderRadius: "12px", border: "1px dashed #453052", textAlign: "center", color: "#8f8099", fontSize: "13px", lineHeight: 1.6 }}>
              Create at least one VANTA field first (Step 1), then come back here to map it.
            </div>
          ) : (
            <form onSubmit={submitMapping} style={{ display: "grid", gap: "14px" }}>
              <label style={lbl}>
                VANTA field to map
                <select style={sel} value={mappingForm.serviceInputFieldId}
                  onChange={(e) => setMappingForm((c) => ({ ...c, serviceInputFieldId: e.target.value }))}>
                  {fieldChoices.map((f) => <option key={f.id} value={f.id}>{f.label} ({f.key})</option>)}
                </select>
              </label>

              <label style={lbl}>
                ReliableSMM service
                <select style={sel} value={mappingForm.providerServiceId}
                  onChange={(e) => setMappingForm((c) => ({ ...c, providerServiceId: e.target.value, providerParameterKey: "" }))}>
                  <option value="">— Select a provider service —</option>
                  {catalogOptions.map((r) => (
                    <option key={r.provider_service_id} value={r.provider_service_id}>{r.name} (#{r.provider_service_id})</option>
                  ))}
                </select>
              </label>

              {selectedCatalog && (
                <div style={{ padding: "12px 14px", borderRadius: "10px", background: "rgba(216,131,255,.07)", border: "1px solid rgba(216,131,255,.2)", fontSize: "12px", color: "#c0b3ca" }}>
                  <strong style={{ color: "#d883ff" }}>ReliableSMM</strong> — Approved params:{" "}
                  {selectedCatalog.parameterKeys.length
                    ? selectedCatalog.parameterKeys.map((k: string) => (
                      <span key={k} style={{ display: "inline-block", margin: "2px 3px 2px 0", padding: "2px 8px", borderRadius: "6px", background: "#2d1241", color: "#d883ff", fontSize: "11px", fontWeight: 700 }}>{k}</span>
                    ))
                    : <span style={{ color: "#ff9baa" }}>Metadata insufficient for safe mapping.</span>
                  }
                </div>
              )}

              {selectedCatalog && hasParams && (
                <label style={lbl}>
                  Provider parameter key
                  <select style={sel} value={mappingForm.providerParameterKey}
                    onChange={(e) => setMappingForm((c) => ({ ...c, providerParameterKey: e.target.value }))}>
                    <option value="">— Select parameter —</option>
                    {selectedCatalog.parameterKeys.map((k: string) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </label>
              )}

              <label style={lbl}>
                Transform
                <select style={sel} value={`${mappingForm.transformId}:${mappingForm.transformVersion}`}
                  onChange={(e) => { const [id, v] = e.target.value.split(":"); setMappingForm((c) => ({ ...c, transformId: id, transformVersion: Number(v) })); }}>
                  {transformOptions.map((t) => <option key={`${t.id}:${t.version}`} value={`${t.id}:${t.version}`}>{t.id} v{t.version}</option>)}
                </select>
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <label style={lbl}>
                  Provider required
                  <select style={sel} value={mappingForm.providerRequired ? "true" : "false"}
                    onChange={(e) => setMappingForm((c) => ({ ...c, providerRequired: e.target.value === "true" }))}>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </label>
                <label style={lbl}>
                  Omit when blank
                  <select style={sel} value={mappingForm.omitWhenBlank ? "true" : "false"}
                    onChange={(e) => setMappingForm((c) => ({ ...c, omitWhenBlank: e.target.value === "true" }))}>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </label>
              </div>

              <button type="submit" style={{ ...primaryBtn, opacity: (!fieldChoices.length || !selectedCatalog || !hasParams) ? 0.45 : 1, cursor: (!fieldChoices.length || !selectedCatalog || !hasParams) ? "not-allowed" : "pointer" }}
                disabled={!fieldChoices.length || !selectedCatalog || !hasParams}>
                Save Mapping
              </button>
            </form>
          )}
        </Card>
      </div>

      {/* ── Configured Fields table ── */}
      <Card style={{ marginTop: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
          <h2 style={{ margin: 0, color: "#fff", fontSize: "17px", fontWeight: 800 }}>Configured Fields</h2>
          <span style={{ padding: "2px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: 700, color: "#d883ff", background: "rgba(216,131,255,.12)" }}>{localFields.length}</span>
        </div>

        {localFields.length === 0 ? (
          <div style={{ padding: "24px", textAlign: "center", color: "#8f8099", fontSize: "14px", border: "1px dashed #352244", borderRadius: "12px" }}>
            No fields configured yet. Use Step 1 above to add your first input field.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="dashboard-table" style={{ minWidth: "640px" }}>
              <thead>
                <tr>
                  <th>Key</th><th>Label</th><th>Type</th><th>Required</th><th>Order</th><th>Status</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {localFields.map((f) => (
                  <tr key={f.id}>
                    <td><code style={{ fontSize: "12px", background: "#21172d", padding: "2px 8px", borderRadius: "6px", color: "#d883ff" }}>{f.key}</code></td>
                    <td style={{ color: "#f7f4fa", fontWeight: 600 }}>{f.label}</td>
                    <td><span style={{ fontSize: "11px", fontWeight: 700, color: "#c0b3ca", background: "#21172d", padding: "2px 8px", borderRadius: "6px", textTransform: "uppercase" }}>{f.input_type}</span></td>
                    <td><Badge color={f.required ? "#86f415" : "#a99bb2"} bg={f.required ? "rgba(134,244,21,.1)" : "rgba(169,155,178,.08)"}>{f.required ? "Required" : "Optional"}</Badge></td>
                    <td style={{ color: "#a99bb2" }}>{f.display_order}</td>
                    <td><Badge color={f.active ? "#86f415" : "#ff9baa"} bg={f.active ? "rgba(134,244,21,.1)" : "rgba(255,113,136,.1)"}>{f.active ? "Active" : "Inactive"}</Badge></td>
                    <td>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button type="button" style={ghostBtn} onClick={() => toggleField(f.id, !f.active)}>{f.active ? "Deactivate" : "Activate"}</button>
                        <button type="button" style={{ ...ghostBtn, color: "#d883ff", borderColor: "rgba(216,131,255,.3)" }}
                          onClick={() => setMappingForm((c) => ({ ...c, serviceInputFieldId: f.id }))}>Map →</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Configured Mappings table ── */}
      <Card style={{ marginTop: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
          <h2 style={{ margin: 0, color: "#fff", fontSize: "17px", fontWeight: 800 }}>Configured Mappings</h2>
          <span style={{ padding: "2px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: 700, color: "#d883ff", background: "rgba(216,131,255,.12)" }}>{localMappings.length}</span>
        </div>

        {localMappings.length === 0 ? (
          <div style={{ padding: "24px", textAlign: "center", color: "#8f8099", fontSize: "14px", border: "1px dashed #352244", borderRadius: "12px" }}>
            No provider mappings yet. Complete Steps 1 & 2 above to link a VANTA field to a ReliableSMM parameter.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="dashboard-table" style={{ minWidth: "700px" }}>
              <thead>
                <tr>
                  <th>VANTA Field</th><th>Provider</th><th>Service ID</th><th>Parameter</th><th>Transform</th><th>Status</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {localMappings.map((m) => {
                  const fieldName = localFields.find((f) => f.id === m.service_input_field_id)?.label ?? m.service_input_field_id;
                  return (
                    <tr key={m.id}>
                      <td style={{ color: "#f7f4fa", fontWeight: 600 }}>{fieldName}</td>
                      <td><span style={{ fontSize: "11px", fontWeight: 700, color: "#d883ff", textTransform: "uppercase" }}>{m.provider}</span></td>
                      <td><code style={{ fontSize: "12px", background: "#21172d", padding: "2px 8px", borderRadius: "6px", color: "#c0b3ca" }}>#{m.provider_service_id}</code></td>
                      <td><code style={{ fontSize: "12px", background: "#21172d", padding: "2px 8px", borderRadius: "6px", color: "#d883ff" }}>{m.provider_parameter_key}</code></td>
                      <td style={{ color: "#a99bb2", fontSize: "12px" }}>{m.transform_id} v{m.transform_version}</td>
                      <td><Badge color={m.active ? "#86f415" : "#ff9baa"} bg={m.active ? "rgba(134,244,21,.1)" : "rgba(255,113,136,.1)"}>{m.active ? "Active" : "Inactive"}</Badge></td>
                      <td><button type="button" style={ghostBtn} onClick={() => toggleMapping(m.id, !m.active)}>{m.active ? "Deactivate" : "Activate"}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
