"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CatalogService } from "../../lib/catalog/services";
import type { CustomerInputField } from "../../lib/customer/service-contract";
import { getFieldControlType, validateCustomerInputValue } from "../../lib/customer/service-contract";
import {
  getTargetRequirements,
  normalizeTargetForService,
  resolveTargetInputField,
} from "../../lib/targets/contracts";
import { calculateCustomerTotal, unitRateToAdminPricePer1000 } from "../../lib/pricing/customer-price";

type StoredOrderIntent = { key: string; fingerprint: string };
const orderIntentStorageKey = (serviceId: string) => `vanta:order-creation-intent:${serviceId}`;
const idempotencyKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function formatCustomerRate(unitRate: string) {
  const [whole, fraction = ""] = unitRateToAdminPricePer1000(unitRate).split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

export function ServiceConfigurator({ service, platform, platformSlug }: { service: CatalogService & { inputFields?: CustomerInputField[] }; platform?: string; platformSlug?: string }) {
  const router = useRouter();
  const dynamicFields = Array.isArray(service.inputFields) ? [...service.inputFields].sort((left, right) => left.displayOrder - right.displayOrder) : [];
  const isDynamic = dynamicFields.length > 0;
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() => Object.fromEntries(dynamicFields.map((field) => [field.key, ""])));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [target, setTarget] = useState("");
  const [quantityInput, setQuantityInput] = useState(String(service.min_quantity));
  const quantity = Number(quantityInput);
  const quantityValid = Number.isInteger(quantity) && quantity >= service.min_quantity && quantity <= service.max_quantity;
  const total = useMemo(() => quantityValid ? calculateCustomerTotal(service.selling_rate, quantity) : "—", [quantity, quantityValid, service.selling_rate]);
  const targetRequirements = getTargetRequirements({ platformSlug, targetType: service.target_type });
  const targetFieldResult = resolveTargetInputField(dynamicFields, service.target_type);
  const targetField = isDynamic ? targetFieldResult.field : null;
  const legacyTargetValidation = normalizeTargetForService({
    platformSlug,
    targetType: service.target_type,
    value: target,
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const orderIdempotencyKey = useRef<StoredOrderIntent | null>(null);
  const orderIdempotencyServiceId = useRef(service.id);

  async function getOrderIdempotencyKey(payload: Record<string, unknown>) {
    if (orderIdempotencyServiceId.current !== service.id) {
      orderIdempotencyKey.current = null;
      try {
        window.sessionStorage.removeItem(orderIntentStorageKey(orderIdempotencyServiceId.current));
      } catch (cause) {
        console.warn("Unable to clear the previous order retry key from this browser session.", cause);
      }
      orderIdempotencyServiceId.current = service.id;
    }
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    const digest = await crypto.subtle.digest("SHA-256", payloadBytes);
    const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (orderIdempotencyKey.current?.fingerprint === fingerprint) return orderIdempotencyKey.current.key;

    try {
      const saved = window.sessionStorage.getItem(orderIntentStorageKey(service.id));
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (
          parsed
          && typeof parsed === "object"
          && "key" in parsed
          && typeof parsed.key === "string"
          && idempotencyKeyPattern.test(parsed.key)
          && "fingerprint" in parsed
          && parsed.fingerprint === fingerprint
        ) {
          orderIdempotencyKey.current = { key: parsed.key, fingerprint };
          return parsed.key;
        }
      }
    } catch (cause) {
      console.warn("Unable to read the saved order retry key from this browser session.", cause);
    }

    const intent = { key: crypto.randomUUID(), fingerprint };
    orderIdempotencyKey.current = intent;
    try {
      window.sessionStorage.setItem(orderIntentStorageKey(service.id), JSON.stringify(intent));
    } catch (cause) {
      console.warn("Unable to save the order retry key in this browser session.", cause);
    }
    return intent.key;
  }

  function beginDifferentOrderIntent() {
    orderIdempotencyKey.current = null;
    orderIdempotencyServiceId.current = service.id;
    try {
      window.sessionStorage.removeItem(orderIntentStorageKey(service.id));
    } catch (cause) {
      console.warn("Unable to clear the order retry key from this browser session.", cause);
    }
  }

  async function submitLegacy() {
    if (!legacyTargetValidation.valid) {
      setError(legacyTargetValidation.reason);
      return;
    }
    if (!quantityValid) {
      setError(`Quantity must be a whole number between ${service.min_quantity.toLocaleString()} and ${service.max_quantity.toLocaleString()}.`);
      return;
    }
    setSubmitting(true); setError("");
    try {
      const payload = { service_id: service.id, target_value: legacyTargetValidation.target, quantity };
      const requestKey = await getOrderIdempotencyKey(payload);
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": requestKey },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (response.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent(`/services/${service.slug}`)}`;
        return;
      }
      if (!response.ok) {
        setError(response.status >= 500
          ? "We couldn’t confirm the order. Retry safely to check this same submission."
          : result.error || "Unable to create order.");
        setSubmitting(false);
        return;
      }
      if (typeof result.public_order_id !== "string" || !result.public_order_id.trim()) {
        setError("We couldn’t confirm the order. Retry safely to check this same submission.");
        setSubmitting(false);
        return;
      }
      beginDifferentOrderIntent();
      router.push(`/checkout?order=${encodeURIComponent(result.public_order_id)}`);
    } catch {
      setError("We couldn’t confirm the order. Retry safely to check this same submission.");
      setSubmitting(false);
    }
  }

  async function submitDynamic() {
    const nextErrors: Record<string, string> = {};
    if (!targetRequirements) {
      setError("This service has an unsupported target configuration. Please contact support.");
      return;
    }
    if (!targetField) {
      setError(targetFieldResult.error ?? "This service is missing its configured target field. Please contact support.");
      return;
    }
    for (const field of dynamicFields) {
      const value = fieldValues[field.key] ?? "";
      const validation = validateCustomerInputValue(field, value);
      if (!validation.isValid) nextErrors[field.key] = validation.error;
      if (field.key === targetField.key) {
        const targetValidation = normalizeTargetForService({
          platformSlug,
          targetType: service.target_type,
          value,
        });
        if (!targetValidation.valid) nextErrors[field.key] = targetValidation.reason;
      }
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setError("Please correct the highlighted fields and try again.");
      return;
    }

    setSubmitting(true); setError("");
    try {
      const payload = {
        service_id: service.id,
        quantity,
        input_values: fieldValues,
      };
      const requestKey = await getOrderIdempotencyKey(payload);
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": requestKey },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (response.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent(`/services/${service.slug}`)}`;
        return;
      }
      if (!response.ok) {
        setError(response.status >= 500
          ? "We couldn’t confirm the order. Retry safely to check this same submission."
          : result.error || "Unable to create order.");
        setSubmitting(false);
        return;
      }
      if (typeof result.public_order_id !== "string" || !result.public_order_id.trim()) {
        setError("We couldn’t confirm the order. Retry safely to check this same submission.");
        setSubmitting(false);
        return;
      }
      beginDifferentOrderIntent();
      router.push(`/checkout?order=${encodeURIComponent(result.public_order_id)}`);
    } catch {
      setError("We couldn’t confirm the order. Retry safely to check this same submission.");
      setSubmitting(false);
    }
  }

  const renderDynamicFields = () => (
    <div className="configurator">
      {dynamicFields.map((field) => {
        const currentValue = fieldValues[field.key] ?? "";
        const controlType = getFieldControlType(field.inputType);
        const fieldError = fieldErrors[field.key];
        const isTarget = field.key === targetField?.key;
        const targetValidation = isTarget ? normalizeTargetForService({
          platformSlug,
          targetType: service.target_type,
          value: currentValue,
        }) : null;
        const targetError = targetValidation && !targetValidation.valid ? targetValidation.reason : null;
        const commonProps = {
          value: currentValue,
          onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            const nextValue = event.target.value;
            beginDifferentOrderIntent();
            setFieldValues((current) => ({ ...current, [field.key]: nextValue }));
            if (fieldError) {
              setFieldErrors((current) => ({ ...current, [field.key]: "" }));
            }
            if (error) setError("");
          },
          placeholder: field.placeholder,
          maxLength: field.validation?.maxLength,
          required: field.required,
          "aria-invalid": Boolean(fieldError) || (isTarget && currentValue.trim().length > 0 && !targetValidation?.valid),
        };

        return <div key={field.key} className="field-group">
          <label>{isTarget && targetRequirements ? targetRequirements.label : field.label}{field.required ? " *" : ""}{controlType === "textarea" ? <textarea {...commonProps} rows={4} /> : <input {...commonProps} type={isTarget || controlType === "url" ? "url" : "text"} placeholder={isTarget && targetRequirements ? targetRequirements.example : field.placeholder} />}</label>
          {isTarget && targetRequirements ? <small>{targetRequirements.description} Example: {targetRequirements.example}</small> : field.helpText && <small>{field.helpText}</small>}
          {(fieldError || (isTarget && currentValue.trim().length > 0 && targetError)) && <p role="alert">{fieldError || targetError}</p>}
        </div>;
      })}
      <label>Quantity<input type="text" inputMode="numeric" value={quantityInput} onChange={(event) => { beginDifferentOrderIntent(); setQuantityInput(event.target.value.replace(/[^0-9]/g, "")); setError(""); }} onBlur={() => { if (quantityInput && !quantityValid) setError(`Quantity must be a whole number between ${service.min_quantity.toLocaleString()} and ${service.max_quantity.toLocaleString()}.`); }} aria-invalid={Boolean(quantityInput) && !quantityValid} /></label>
      <div className="config-summary"><span>Total</span><strong>{service.currency} {total}</strong></div>
      {error && <p className="order-field-error" role="alert">{error}</p>}
      <button className="service-action-link" type="button" onClick={submitDynamic} disabled={submitting || !quantityValid || !targetField || !targetRequirements || !normalizeTargetForService({ platformSlug, targetType: service.target_type, value: fieldValues[targetField?.key ?? ""] ?? "" }).valid}>{submitting ? "Checking fields…" : "Continue"}</button>
    </div>
  );

  return <div className="order-builder">
    <div className="order-builder-form">
      <div className="order-form-kicker">ORDER DETAILS</div>
      <h2>{service.name}</h2>
      <p className="order-form-intro">{isDynamic ? `Provide the requested details for this ${platform ?? "VANTA"} order.` : `Set the target and quantity for this ${platform ?? "VANTA"} service.`}</p>
      <div className="order-form-rate"><span>Rate per 1,000</span><strong>{service.currency} {formatCustomerRate(service.selling_rate)}</strong></div>
      {isDynamic ? renderDynamicFields() : <div className="configurator">
        <label>{targetRequirements?.label ?? "Target URL"}<input type="url" required value={target} onChange={(event) => { beginDifferentOrderIntent(); setTarget(event.target.value); }} placeholder={targetRequirements?.example ?? "https://..."} aria-invalid={target.trim().length > 0 && !legacyTargetValidation.valid} /></label>
        {targetRequirements ? <small>{targetRequirements.description} Example: {targetRequirements.example}</small> : <p role="alert">This service has an unsupported target configuration. Please contact support.</p>}
        {target.trim().length > 0 && !legacyTargetValidation.valid && <p className="order-field-error" role="alert">{legacyTargetValidation.reason}</p>}
        <label>Quantity<input type="text" inputMode="numeric" value={quantityInput} onChange={(event) => { beginDifferentOrderIntent(); setQuantityInput(event.target.value.replace(/[^0-9]/g, "")); setError(""); }} onBlur={() => { if (quantityInput && !quantityValid) setError(`Quantity must be a whole number between ${service.min_quantity.toLocaleString()} and ${service.max_quantity.toLocaleString()}.`); }} aria-invalid={Boolean(quantityInput) && !quantityValid} /></label>
        <div className="quantity-tools"><input className="quantity-range" type="range" min={service.min_quantity} max={service.max_quantity} step="1" value={quantityValid ? quantity : service.min_quantity} onChange={(event) => { beginDifferentOrderIntent(); setQuantityInput(event.target.value); setError(""); }} aria-label="Choose quantity with slider" /><select aria-label="Choose a common quantity" value="" onChange={(event) => { if (event.target.value) { beginDifferentOrderIntent(); setQuantityInput(event.target.value); setError(""); } }}><option value="">Quick choose</option><option value={String(service.min_quantity)}>Minimum ({service.min_quantity.toLocaleString()})</option><option value={String(Math.min(service.max_quantity, service.min_quantity * 2))}>Starter</option><option value={String(Math.min(service.max_quantity, 1000))}>1,000</option><option value={String(Math.min(service.max_quantity, 10000))}>10,000</option></select></div>
        <div className="config-summary"><span>Total</span><strong>{service.currency} {total}</strong></div>
        {error && <p className="order-field-error" role="alert">{error}</p>}
        <button className="service-action-link" type="button" onClick={submitLegacy} disabled={submitting || !quantityValid || !targetRequirements || !legacyTargetValidation.valid}>{submitting ? "Creating order…" : "Continue to checkout"}</button>
      </div>}
    </div>
    <aside className="order-builder-summary">
      <span className="catalog-eyebrow">YOUR SELECTION</span>
      <div className="summary-service">
        <span className="platform-logo">{platform?.slice(0, 1) ?? "V"}</span>
        <div><strong>{service.name}</strong><small>{platform ?? "VANTA"} · {service.category}</small></div>
      </div>
      <div className="summary-row"><span>Customer rate</span><strong>{service.currency} {calculateCustomerTotal(service.selling_rate, 1000)} / 1,000 units</strong></div>
      <div className="summary-row"><span>Quantity</span><strong>{quantityValid ? quantity.toLocaleString() : "—"}</strong></div>
      <div className="summary-row"><span>Price</span><strong>{service.currency} {total}</strong></div>
      <p className="summary-note">Secure checkout follows after you review your order.</p>
    </aside>
  </div>;
}
