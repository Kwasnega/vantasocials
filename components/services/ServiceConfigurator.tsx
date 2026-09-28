"use client";

import { useMemo, useState } from "react";
import type { CatalogService } from "../../lib/catalog/services";

export function ServiceConfigurator({ service }: { service: CatalogService }) {
  const [target, setTarget] = useState("");
  const [quantity, setQuantity] = useState(service.min_quantity);
  const total = useMemo(() => (quantity * Number(service.selling_rate)).toFixed(2), [quantity, service.selling_rate]);
  const label = service.target_type === "username" ? "Username" : service.target_type === "channel" ? "Channel" : service.target_type === "page" ? "Page" : "Post or profile URL";
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function submit() {
    setSubmitting(true); setError("");
    const response = await fetch("/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ service_id: service.id, target_value: target, quantity }) });
    const result = await response.json();
    if (response.status === 401) { window.location.href = `/login?next=${encodeURIComponent(`/services/${service.slug}`)}`; return; }
    if (!response.ok) { setError(result.error || "Unable to create order."); setSubmitting(false); return; }
    window.location.href = `/checkout?order=${encodeURIComponent(result.public_order_id)}`;
  }
  return <div className="configurator">
    <label>{label}<input value={target} onChange={(event) => setTarget(event.target.value)} placeholder={service.target_type === "username" ? "@username" : "https://..."} /></label>
    <label>Quantity<input type="number" min={service.min_quantity} max={service.max_quantity} value={quantity} onChange={(event) => setQuantity(Math.min(service.max_quantity, Math.max(service.min_quantity, Number(event.target.value))))} /></label>
    <div className="config-summary"><span>Total</span><strong>${total}</strong></div>
    {error && <p role="alert">{error}</p>}
    <button className="service-action-link" type="button" onClick={submit} disabled={submitting}>{submitting ? "Creating order…" : "Continue to checkout"}</button>
  </div>;
}
