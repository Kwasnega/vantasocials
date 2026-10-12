"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { calculatePricing, formatGhsAmount, normalizePricingValue, type RateUnit } from "../../../lib/pricing/engine";
import { adminPricePer1000ToUnitRate, unitRateToAdminPricePer1000 } from "../../../lib/pricing/customer-price";

type ServicePricing = {
  selling_rate: string | number;
  currency: string;
  provider_rate: string | number | null;
  provider_rate_unit: string | null;
  provider_currency: string | null;
};

export function PriceOnlyControl({
  slug,
  serviceName,
  providerRate,
  providerRateUnit,
  providerCurrency,
  fxRate,
}: {
  slug: string;
  serviceName: string;
  providerRate: string | number | null;
  providerRateUnit: string | null;
  providerCurrency: string | null;
  fxRate: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [currentFx, setCurrentFx] = useState(fxRate);
  const [fxError, setFxError] = useState<string | null>(null);
  const [fxUpdatedAt, setFxUpdatedAt] = useState<string | null>(null);
  const [fxSource, setFxSource] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState("loading");
    setPrice("");
    setMessage("");
    fetch(`/api/admin/pricing?service_id=${encodeURIComponent(slug)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load saved customer pricing.");
        const service = (body.services ?? []).find((item: { slug: string }) => item.slug === slug) as ServicePricing | undefined;
        if (!service) throw new Error("Saved service pricing was not included in the response.");
        return { service, body };
      })
      .then(({ service, body }) => {
        if (cancelled) return;
        setPrice(unitRateToAdminPricePer1000(service.selling_rate));
        setCurrentFx(body.fxRate ?? null);
        setFxError(body.fxError ?? null);
        setFxUpdatedAt(body.fxUpdatedAt ?? null);
        setFxSource(body.fxSource ?? null);
        setState("loaded");
      })
      .catch((error) => {
        if (cancelled) return;
        setState("error");
        setMessage(error instanceof Error ? error.message : "Could not load saved customer pricing.");
      });
    return () => { cancelled = true; };
  }, [open, slug, attempt]);

  const economics = useMemo(() => {
    if (
      state !== "loaded" ||
      providerRate == null ||
      !providerRateUnit ||
      !["PER_1000", "PER_ORDER"].includes(providerRateUnit) ||
      providerCurrency !== "USD" ||
      !currentFx
    ) return null;
    try {
      const inputs = {
        providerRate: normalizePricingValue(providerRate),
        providerRateUnit: providerRateUnit as RateUnit,
        providerCurrency: "USD" as const,
        fxRate: normalizePricingValue(currentFx, false),
        sellingPricePerUnit: adminPricePer1000ToUnitRate(price),
        sellingCurrency: "GHS" as const,
      };
      return {
        per1000: calculatePricing({ ...inputs, quantity: 1000 }),
        per10000: calculatePricing({ ...inputs, quantity: 10000 }),
      };
    } catch {
      return null;
    }
  }, [state, providerRate, providerRateUnit, providerCurrency, currentFx, price]);

  async function save() {
    if (state !== "loaded" || !/^\d+(?:\.\d{1,3})?$/.test(price)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/pricing/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellingPricePer1000: price }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Customer price could not be saved.");
      setOpen(false);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Customer price could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="service-card-action" onClick={() => { setState("idle"); setOpen(true); }}>
        Edit customer price
      </button>
      {open && (
        <div className="mapping-modal-backdrop">
          <section className="mapping-modal price-edit-modal" role="dialog" aria-modal="true" aria-labelledby={`price-edit-${slug}`}>
            <header className="mapping-modal-header">
              <div>
                <p className="dashboard-kicker">CUSTOMER PRICE ONLY</p>
                <h2 id={`price-edit-${slug}`}>{serviceName}</h2>
                <p>Changing this price does not change the provider mapping or existing orders.</p>
              </div>
              <button type="button" className="mapping-modal-close" onClick={() => !busy && setOpen(false)} aria-label="Close price editor">×</button>
            </header>
            {message && <p className="mapping-message" role="alert">{message}</p>}
            {state === "loading" && <p className="pricing-popup-unavailable" role="status">Loading saved customer price…</p>}
            {state === "error" && (
              <div className="pricing-popup-unavailable" role="alert">
                Saved price could not be verified. Saving is disabled.
                <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry loading saved price</button>
              </div>
            )}
            {state === "loaded" && (
              <div className="pricing-popup-body">
                <label className="pricing-popup-input">
                  <span>Customer selling price (GHS per 1,000 units)</span>
                  <div><b>₵</b><input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} aria-label="Customer selling price per 1,000 units" /></div>
                </label>
                {!economics ? (
                  <p className="pricing-popup-unavailable">
                    Economics unavailable: {fxError ?? (!currentFx ? "USD → GHS FX is not configured." : "provider rate, supported billing unit, USD currency, or valid FX rate is missing.")}
                  </p>
                ) : (
                  <div className="price-edit-economics">
                    <p>Provider cost: ${providerRate} {providerCurrency} / {providerRateUnit === "PER_ORDER" ? "order" : "1,000"} · estimated at FX ₵{currentFx} per USD · {fxSource ?? "source unknown"} · {fxUpdatedAt ? new Date(fxUpdatedAt).toLocaleString() : "FX freshness unknown"}.</p>
                    <div><strong>1,000 units</strong><span>Revenue ₵{formatGhsAmount(economics.per1000.revenueGhs)} · Cost ₵{formatGhsAmount(economics.per1000.providerCostGhs)} · Profit ₵{formatGhsAmount(economics.per1000.grossProfitGhs)} · Margin {economics.per1000.grossMarginPercent ?? "Unavailable"}%</span></div>
                    <div><strong>10,000 units</strong><span>Revenue ₵{formatGhsAmount(economics.per10000.revenueGhs)} · Cost ₵{formatGhsAmount(economics.per10000.providerCostGhs)} · Profit ₵{formatGhsAmount(economics.per10000.grossProfitGhs)} · Margin {economics.per10000.grossMarginPercent ?? "Unavailable"}%</span></div>
                  </div>
                )}
              </div>
            )}
            <div className="mapping-modal-actions">
              <button type="button" className="mapping-cancel" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="mapping-confirm" disabled={state !== "loaded" || busy || !/^\d+(?:\.\d{1,3})?$/.test(price)} onClick={() => void save()}>
                {busy ? "Saving…" : "Save customer price"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
