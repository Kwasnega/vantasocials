"use client";

import { useMemo, useState } from "react";
import type { CatalogService } from "../../lib/catalog/services";
import { getTargetContract } from "../../lib/targets/contracts";

export function ServiceConfigurator({ service, platform }: { service: CatalogService; platform?: string }) {
  const [target, setTarget] = useState("");
  const [quantityInput, setQuantityInput] = useState(String(service.min_quantity));
  const quantity = Number(quantityInput);
  const quantityValid = Number.isInteger(quantity) && quantity >= service.min_quantity && quantity <= service.max_quantity;
  const total = useMemo(() => quantityValid ? (quantity * Number(service.selling_rate)).toFixed(2) : "—", [quantity, quantityValid, service.selling_rate]);
  const contract = getTargetContract(service.slug);
  const label = contract?.includes("PROFILE") ? "Profile username or URL" : contract === "YOUTUBE_CHANNEL" ? "YouTube channel URL" : contract?.includes("VIDEO") ? "Video URL" : contract === "FACEBOOK_POST" ? "Facebook post URL" : contract === "FACEBOOK_PAGE" ? "Facebook page URL" : contract === "INSTAGRAM_CONTENT" ? "Instagram post or reel URL" : service.target_type === "username" ? "Username" : service.target_type === "channel" ? "Channel" : service.target_type === "page" ? "Page" : "Post or profile URL";
  const placeholder = contract?.includes("PROFILE") ? "@username or https://..." : contract ? "https://..." : service.target_type === "username" ? "@username" : "https://...";
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function submit() {
    if (!quantityValid) { setError(`Quantity must be a whole number between ${service.min_quantity.toLocaleString()} and ${service.max_quantity.toLocaleString()}.`); return; }
    setSubmitting(true); setError("");
    const response = await fetch("/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ service_id: service.id, target_value: target, quantity }) });
    const result = await response.json();
    if (response.status === 401) { window.location.href = `/login?next=${encodeURIComponent(`/services/${service.slug}`)}`; return; }
    if (!response.ok) { setError(result.error || "Unable to create order."); setSubmitting(false); return; }
    window.location.href = `/checkout?order=${encodeURIComponent(result.public_order_id)}`;
  }
  const targetLabel = label;
  return <div className="order-builder"><div className="order-builder-form"><div className="order-form-kicker">ORDER DETAILS</div><h2>{service.name}</h2><p className="order-form-intro">Set the target and quantity for this {platform ?? "VANTA"} service.</p><div className="configurator">
    <label>{targetLabel}<input value={target} onChange={(event) => setTarget(event.target.value)} placeholder={placeholder} /></label>
    <label>Quantity<input type="text" inputMode="numeric" value={quantityInput} onChange={(event) => { setQuantityInput(event.target.value.replace(/[^0-9]/g, "")); setError(""); }} onBlur={() => { if (quantityInput && !quantityValid) setError(`Quantity must be a whole number between ${service.min_quantity.toLocaleString()} and ${service.max_quantity.toLocaleString()}.`); }} aria-invalid={Boolean(quantityInput) && !quantityValid} /></label>
    <div className="quantity-tools"><input className="quantity-range" type="range" min={service.min_quantity} max={service.max_quantity} step="1" value={quantityValid ? quantity : service.min_quantity} onChange={(event) => { setQuantityInput(event.target.value); setError(""); }} aria-label="Choose quantity with slider" /><select aria-label="Choose a common quantity" value="" onChange={(event) => { if (event.target.value) { setQuantityInput(event.target.value); setError(""); } }}><option value="">Quick choose</option><option value={String(service.min_quantity)}>Minimum ({service.min_quantity.toLocaleString()})</option><option value={String(Math.min(service.max_quantity, service.min_quantity * 2))}>Starter</option><option value={String(Math.min(service.max_quantity, 1000))}>1,000</option><option value={String(Math.min(service.max_quantity, 10000))}>10,000</option></select></div>
    <div className="config-summary"><span>Total</span><strong>{service.currency} {total}</strong></div>
    {error && <p className="order-field-error" role="alert">{error}</p>}
    <button className="service-action-link" type="button" onClick={submit} disabled={submitting}>{submitting ? "Creating order…" : "Continue to checkout"}</button>
  </div></div><aside className="order-builder-summary"><span className="catalog-eyebrow">YOUR SELECTION</span><div className="summary-service"><span className="platform-logo">{platform?.slice(0, 1) ?? "V"}</span><div><strong>{service.name}</strong><small>{platform ?? "VANTA"} · {service.category}</small></div></div><div className="summary-row"><span>Quantity</span><strong>{quantityValid ? quantity.toLocaleString() : "—"}</strong></div><div className="summary-row"><span>Price</span><strong>{service.currency} {total}</strong></div><p className="summary-note">Secure checkout follows after you review your order.</p></aside></div>;
}
