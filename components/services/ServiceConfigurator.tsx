"use client";

import { useMemo, useState } from "react";
import type { CatalogService } from "../../lib/catalog/services";
import type { CustomerInputField } from "../../lib/customer/service-contract";
import { getFieldControlType, validateCustomerInputValue } from "../../lib/customer/service-contract";

export function ServiceConfigurator({ service }: { service: CatalogService & { inputFields?: CustomerInputField[] } }) {
  const dynamicFields = Array.isArray(service.inputFields) ? [...service.inputFields].sort((left, right) => left.displayOrder - right.displayOrder) : [];
  const isDynamic = dynamicFields.length > 0;
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() => Object.fromEntries(dynamicFields.map((field) => [field.key, ""])));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [target, setTarget] = useState("");
  const [quantity, setQuantity] = useState(service.min_quantity);
  const total = useMemo(() => (quantity * Number(service.selling_rate)).toFixed(2), [quantity, service.selling_rate]);
  const label = service.target_type === "username" ? "Username" : service.target_type === "channel" ? "Channel" : service.target_type === "page" ? "Page" : "Post or profile URL";
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submitLegacy() {
    setSubmitting(true); setError("");
    const response = await fetch("/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ service_id: service.id, target_value: target, quantity }) });
    const result = await response.json();
    if (response.status === 401) { window.location.href = `/login?next=${encodeURIComponent(`/services/${service.slug}`)}`; return; }
    if (!response.ok) { setError(result.error || "Unable to create order."); setSubmitting(false); return; }
    window.location.href = `/checkout?order=${encodeURIComponent(result.public_order_id)}`;
  }

  async function submitDynamic() {
    const nextErrors: Record<string, string> = {};
    for (const field of dynamicFields) {
      const value = fieldValues[field.key] ?? "";
      const validation = validateCustomerInputValue(field, value);
      if (!validation.isValid) nextErrors[field.key] = validation.error;
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setError("Please correct the highlighted fields and try again.");
      return;
    }

    setSubmitting(true); setError("");
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          service_id: service.id,
          quantity,
          input_values: fieldValues,
        }),
      });
      const result = await response.json();
      if (response.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent(`/services/${service.slug}`)}`;
        return;
      }
      if (!response.ok) {
        setError(result.error || "Unable to create order.");
        setSubmitting(false);
        return;
      }
      window.location.href = `/checkout?order=${encodeURIComponent(result.public_order_id)}`;
    } catch {
      setError("Unable to create order.");
      setSubmitting(false);
    }
  }

  if (isDynamic) {
    return <div className="configurator">
      {dynamicFields.map((field) => {
        const currentValue = fieldValues[field.key] ?? "";
        const controlType = getFieldControlType(field.inputType);
        const fieldError = fieldErrors[field.key];
        const commonProps = {
          value: currentValue,
          onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            const nextValue = event.target.value;
            setFieldValues((current) => ({ ...current, [field.key]: nextValue }));
            if (fieldError) {
              setFieldErrors((current) => ({ ...current, [field.key]: "" }));
            }
            if (error) setError("");
          },
          placeholder: field.placeholder,
          maxLength: field.validation?.maxLength,
          required: field.required,
        };

        return <div key={field.key} className="field-group">
          <label>{field.label}{field.required ? " *" : ""}{controlType === "textarea" ? <textarea {...commonProps} rows={4} /> : <input {...commonProps} type={controlType === "url" ? "url" : "text"} />}</label>
          {field.helpText && <small>{field.helpText}</small>}
          {fieldError && <p role="alert">{fieldError}</p>}
        </div>;
      })}
      {error && <p role="alert">{error}</p>}
      <button className="service-action-link" type="button" onClick={submitDynamic} disabled={submitting}>{submitting ? "Checking fields…" : "Continue"}</button>
    </div>;
  }

  return <div className="configurator">
    <label>{label}<input value={target} onChange={(event) => setTarget(event.target.value)} placeholder={service.target_type === "username" ? "@username" : "https://..."} /></label>
    <label>Quantity<input type="number" min={service.min_quantity} max={service.max_quantity} value={quantity} onChange={(event) => setQuantity(Math.min(service.max_quantity, Math.max(service.min_quantity, Number(event.target.value))))} /></label>
    <div className="config-summary"><span>Total</span><strong>${total}</strong></div>
    {error && <p role="alert">{error}</p>}
    <button className="service-action-link" type="button" onClick={submitLegacy} disabled={submitting}>{submitting ? "Creating order…" : "Continue to checkout"}</button>
  </div>;
}
