"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { calculatePricing, formatGhsAmount, normalizePricingValue, type PricingResult, type RateUnit } from "../../../lib/pricing/engine";
import { adminPricePer1000ToUnitRate, unitRateToAdminPricePer1000 } from "../../../lib/pricing/customer-price";

type Row = {
  provider_service_id: string;
  name: string;
  description?: string;
  provider_rate: string;
  provider_currency: string;
  rate_unit: string;
  min_quantity: number;
  max_quantity: number;
  refill_supported: boolean;
  cancel_supported: boolean;
  eligibility: "ELIGIBLE" | "MANUAL_REVIEW" | "BLOCKED";
  eligibility_reason: string;
};

const basis = (unit: string) =>
  unit === "PER_1000" ? "1,000" : unit === "PER_ORDER" ? "order" : unit === "PER_UNIT" ? "1 unit" : "unsupported basis";
const validCustomerPrice = (value: string) => {
  try {
    adminPricePer1000ToUnitRate(value, false);
    return true;
  } catch {
    return false;
  }
};
const validFxRate = (value: string | null) => {
  if (value == null) return false;
  try {
    normalizePricingValue(value, false);
    return true;
  } catch {
    return false;
  }
};

export function MappingControl({
  serviceId,
  serviceSlug,
  serviceName,
  current,
}: {
  serviceId: string;
  serviceSlug: string;
  serviceName: string;
  current: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const selectedIdentity = useRef<string | null>(null);
  const [showBlocked, setShowBlocked] = useState(false);
  const [candidateLoadError, setCandidateLoadError] = useState(false);
  const [price, setPrice] = useState("");
  const [priceLoadState, setPriceLoadState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [priceLoadAttempt, setPriceLoadAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [fx, setFx] = useState<string | null>(null);
  const [fxError, setFxError] = useState<string | null>(null);
  const [fxSource, setFxSource] = useState<string | null>(null);
  const [fxUpdatedAt, setFxUpdatedAt] = useState<string | null>(null);

  const identity = (row: Row) => `reliablesmm:${row.provider_service_id}`;

  useEffect(() => {
    if (!open || step !== 1) return;
    let cancelled = false;
    setBusy(true);
    setCandidateLoadError(false);
    fetch(`/api/admin/provider-catalog?vanta_slug=${encodeURIComponent(serviceSlug)}`)
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error || "Candidate lookup failed.");
        if (!cancelled) {
          const next = b.services ?? [];
          const wanted = selectedIdentity.current ?? (current ? `reliablesmm:${current}` : null);
          const match =
            next.find(
              (row: Row) =>
                wanted === identity(row) &&
                row.eligibility === "ELIGIBLE"
            ) ?? null;
          setRows(next);
          setSelected(match);
          selectedIdentity.current = match ? identity(match) : null;
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setCandidateLoadError(true);
          setMessage(e instanceof Error ? e.message : "Candidate lookup failed.");
        }
      })
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [open, step, serviceSlug, current]);

  useEffect(() => {
    if (!open || step !== 2) return;
    let cancelled = false;
    setPrice("");
    setFx(null);
    setFxError(null);
    setFxSource(null);
    setFxUpdatedAt(null);
    setPriceLoadState("loading");
    fetch(`/api/admin/pricing?service_id=${encodeURIComponent(serviceId)}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || "Pricing data could not be loaded.");
        return body;
      })
      .then((b) => {
        if (!cancelled) {
          setFx(b.fxRate ?? null);
          setFxError(b.fxError ?? null);
          setFxSource(b.fxSource ?? null);
          setFxUpdatedAt(b.fxUpdatedAt ?? null);
          const service = (b.services ?? []).find((item: { id: string }) => item.id === serviceId);
          if (!service) throw new Error("Saved service pricing was not included in the response.");
          setPrice(service?.selling_rate == null ? "" : unitRateToAdminPricePer1000(service.selling_rate));
          setPriceLoadState("loaded");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setPriceLoadState("error");
          setMessage(error instanceof Error ? error.message : "Pricing data could not be loaded.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, step, serviceId, priceLoadAttempt]);

  const unit = selected?.rate_unit ?? "UNKNOWN";
  const supportedUnits: RateUnit[] = ["PER_1000", "PER_ORDER"];
  const isUnitSupported = supportedUnits.includes(unit as RateUnit);
  const isFxValid = validFxRate(fx);

  const economics = useMemo<PricingResult | null>(() => {
    if (
      !selected ||
      !fx ||
      !isFxValid ||
      !validCustomerPrice(price) ||
      !isUnitSupported
    ) {
      return null;
    }
    try {
      return calculatePricing({
        providerRate: normalizePricingValue(selected.provider_rate),
        providerRateUnit: unit as RateUnit,
        providerCurrency: "USD",
        fxRate: normalizePricingValue(fx, false),
        sellingPricePerUnit: adminPricePer1000ToUnitRate(price),
        sellingCurrency: "GHS",
        quantity: 10000,
      });
    } catch {
      return null;
    }
  }, [selected, fx, isFxValid, price, unit, isUnitSupported]);

  function close() {
    if (!busy) {
      setOpen(false);
      setStep(1);
      setSelected(null);
      selectedIdentity.current = null;
      setMessage("");
    }
  }

  async function save() {
    if (priceLoadState !== "loaded" || !selected || !validCustomerPrice(price)) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/mappings-and-pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_id: serviceId,
          provider_service_id: selected.provider_service_id,
          sellingPricePer1000: price,
        }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || "Unable to save mapping.");
      close();
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to save mapping.");
    } finally {
      setBusy(false);
    }
  }

  const visible = rows.filter((row) => showBlocked || row.eligibility !== "BLOCKED");

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setStep(1);
          setMessage("");
        }}
      >
        {current ? "Change mapping" : "Map service"}
      </button>

      {open && (
        <div className="mapping-modal-backdrop">
          <section
            className="mapping-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mapping-title"
          >
            <div className="mapping-modal-header">
              <div>
                <p className="dashboard-kicker">{step === 1 ? "MAP SERVICE" : "VANTA PRICING"}</p>
                <h2 id="mapping-title">
                  {step === 1 ? serviceName : "Configure VANTA Pricing"}
                </h2>
                <p>
                  {step === 1
                    ? "Select an eligible ReliableSMM catalog service to fulfill this service."
                    : "Provider economics stay internal; you control the customer selling price."}
                </p>
              </div>
              <button
                type="button"
                className="mapping-modal-close"
                onClick={close}
                aria-label="Close mapping dialog"
              >
                ×
              </button>
            </div>

            {message && (
              <p className="mapping-message" role="alert">
                {message}
              </p>
            )}

            {step === 1 ? (
              <>
                <div className="mapping-results">
                  {busy ? (
                    <p className="mapping-empty">Loading matching services…</p>
                  ) : candidateLoadError ? (
                    <p className="mapping-empty">Provider candidate data could not be loaded. The empty list is not a compatibility result.</p>
                  ) : visible.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "28px 10px" }}>
                      <p className="mapping-empty" style={{ margin: "0 0 12px" }}>
                        No compatible provider services found directly.
                      </p>
                      {rows.some((row) => row.eligibility === "BLOCKED") && (
                        <button
                          type="button"
                          className="mapping-cancel"
                          onClick={() => setShowBlocked((v) => !v)}
                          style={{ margin: "0 auto" }}
                        >
                          {showBlocked
                            ? "Hide incompatible services"
                            : "Show all catalog matches anyway"}
                        </button>
                      )}
                    </div>
                  ) : (
                    visible.map((row) => (
                      <button
                        type="button"
                        disabled={row.eligibility !== "ELIGIBLE"}
                        className={`mapping-option${
                          selected?.provider_service_id === row.provider_service_id
                            ? " is-selected"
                            : ""
                        }`}
                        key={row.provider_service_id}
                        onClick={() => {
                          setSelected(row);
                          selectedIdentity.current = identity(row);
                        }}
                      >
                        <span className="mapping-option-id">#{row.provider_service_id}</span>
                        <span className="mapping-option-main">
                          <strong>{row.name}</strong>
                          <small>{row.description}</small>
                          <small>
                            ${row.provider_rate} /{" "}
                            {row.rate_unit === "PER_1000"
                              ? "1,000"
                              : row.rate_unit === "PER_ORDER"
                              ? "order"
                              : row.rate_unit === "PER_UNIT"
                              ? "unit"
                              : row.rate_unit}
                          </small>
                          <small>
                            Range: {row.min_quantity.toLocaleString()}–
                            {row.max_quantity.toLocaleString()} · Refill:{" "}
                            {row.refill_supported ? "Yes" : "No"} · Cancel:{" "}
                            {row.cancel_supported ? "Yes" : "No"}
                          </small>
                          <b>
                            {row.eligibility === "ELIGIBLE"
                              ? "✓ Eligible"
                              : `Compatible — ${row.eligibility_reason}`}
                          </b>
                        </span>
                      </button>
                    ))
                  )}

                  {rows.some((row) => row.eligibility === "BLOCKED") && visible.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowBlocked((v) => !v)}
                      style={{
                        margin: "12px auto 6px",
                        display: "block",
                        background: "transparent",
                        border: "0",
                        color: "#a99bb2",
                        cursor: "pointer",
                        textDecoration: "underline",
                        fontSize: "12px",
                      }}
                    >
                      {showBlocked ? "Hide incompatible services" : "Show incompatible services"}
                    </button>
                  )}
                </div>

                <div className="mapping-modal-actions">
                  <button type="button" className="mapping-cancel" onClick={close}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="mapping-confirm"
                    disabled={!selected || selected.eligibility !== "ELIGIBLE"}
                    onClick={() => setStep(2)}
                  >
                    Continue to Pricing →
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="pricing-popup-body">
                  {/* Provider Summary Panel */}
                  <div className="pricing-provider-summary">
                    <span>PROVIDER CONFIGURATION</span>
                    <strong>{selected?.name || serviceName}</strong>
                    <small>PROVIDER · ReliableSMM #{selected?.provider_service_id}</small>
                    <div style={{ marginTop: "10px", display: "grid", gap: "6px" }}>
                      <span style={{ color: "#a99bb2", fontSize: "12px" }}>
                        Rate &amp; Unit: <strong>${selected?.provider_rate} USD</strong> / {basis(unit)}
                      </span>
                      <span style={{ color: "#a99bb2", fontSize: "12px" }}>
                        Billing Model: <strong style={{ color: "#d883ff" }}>{unit}</strong>
                      </span>
                    </div>
                  </div>

                  {/* Provider Cost & FX Panel */}
                  <div className="pricing-cost-panel">
                    <p className="dashboard-kicker">NORMALIZED PROVIDER COST (GHS)</p>
                    {!isUnitSupported ? (
                      <strong style={{ color: "#ffb0bc" }}>Pricing basis {unit} requires review</strong>
                    ) : !isFxValid ? (
                      <div>
                        <strong style={{ color: "#ffcf7a" }}>{fxError ? "USD → GHS FX rate is invalid" : "USD → GHS FX rate unavailable"}</strong>
                        <p style={{ color: "#ffb0bc", fontSize: "12px", marginTop: "4px" }}>
                          {fxError ?? "Cost and profit estimates cannot be trusted until a valid FX rate is configured. You may still save the supported mapping and customer price."}
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="pricing-cost-value">
                          ₵{economics ? formatGhsAmount(economics.providerCostGhsPerBasis) : "—"}{" "}
                          <small>/ {basis(unit)}</small>
                        </div>
                        <p style={{ fontSize: "12px", color: "#bca8c8", marginTop: "6px" }}>
                          Exchange rate: <strong>₵{fx} per $1 USD</strong>
                          {fxSource ? ` (${fxSource})` : ""}
                          {fxUpdatedAt ? ` · Updated ${new Date(fxUpdatedAt).toLocaleDateString()}` : ""}
                              {!fxUpdatedAt ? " · FX freshness unknown" : ""}
                            </p>
                      </>
                    )}
                  </div>

                  {/* Customer Selling Price Input */}
                  <label className="pricing-popup-input">
                    <span>VANTA CUSTOMER SELLING PRICE (GHS PER 1,000 UNITS)</span>
                    <div>
                      <b>₵</b>
                      <input
                        inputMode="decimal"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        placeholder="e.g. 5.00"
                        aria-label="VANTA customer price"
                      />
                    </div>
                    <small style={{ color: "#a99bb2", fontSize: "12px", marginTop: "4px" }}>
                      Customers pay this amount per 1,000 units. Provider cost uses the provider’s own billing unit.
                    </small>
                  </label>

                  {priceLoadState === "loading" && (
                    <p className="pricing-popup-unavailable" role="status">Loading the currently saved customer price…</p>
                  )}
                  {priceLoadState === "error" && (
                    <div className="pricing-popup-unavailable" role="alert">
                      The saved customer price could not be verified. Saving is disabled.
                      <button type="button" onClick={() => setPriceLoadAttempt((attempt) => attempt + 1)}>
                        Retry loading saved price
                      </button>
                    </div>
                  )}

                  {/* Real-time Profit & Margin Calculator */}
                  {economics && isUnitSupported && isFxValid && (
                    <div className={`pricing-popup-preview${economics.lossOrNoMargin ? " is-loss" : ""}`}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", width: "100%" }}>
                        <div>
                          <span>
                            {unit === "PER_ORDER" ? "Estimated profit at 10,000 units" : "Profit / 1,000 units"}
                          </span>
                          <strong className={`profit-${economics.profitability.toLowerCase()}`}>
                            ₵{formatGhsAmount(unit === "PER_ORDER" ? economics.projection10k?.profitGhs ?? "0" : economics.grossProfitGhsPer1000 ?? "0")}
                          </strong>
                        </div>
                        <div>
                          <span>Profit Margin</span>
                          <strong className={`profit-${economics.profitability.toLowerCase()}`}>
                            {economics.grossMarginPercent ?? "—"}%
                          </strong>
                        </div>
                        <div>
                          <span>Profitability</span>
                          <strong className={`profit-${economics.profitability.toLowerCase()}`}>
                            {economics.profitability === "BREAK_EVEN" ? "Break-even" : economics.profitability === "LOSS" ? "Loss" : "Profit"}
                          </strong>
                        </div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", width: "100%", marginTop: "8px" }}>
                        <div>
                          <span>Markup over Provider Cost</span>
                          <strong style={{ color: "#d8c8e0", fontSize: "16px" }}>
                            {economics.markupPercent != null ? `${economics.markupPercent}%` : "—"}
                          </strong>
                        </div>
                        <div>
                          <span>Provider Cost in GHS</span>
                          <strong style={{ color: "#d8c8e0", fontSize: "16px" }}>
                            ₵{formatGhsAmount(economics.providerCostGhsPerBasis)} / {basis(unit)}
                          </strong>
                        </div>
                      </div>

                      {economics.projection10k && (
                        <div style={{ gridColumn: "1 / -1", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "10px", marginTop: "6px" }}>
                          <span style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", color: "#a9cbbd" }}>
                            10,000-Unit Projection
                          </span>
                          <p style={{ margin: "4px 0 0", color: "#c2d8cf", fontSize: "12px", lineHeight: "1.4" }}>
                            Customer revenue: <strong>₵{formatGhsAmount(economics.projection10k.revenueGhs)}</strong> · Provider cost: <strong>₵{formatGhsAmount(economics.projection10k.providerCostGhs)}</strong> · Estimated profit: <strong>₵{formatGhsAmount(economics.projection10k.profitGhs)}</strong>
                          </p>
                        </div>
                      )}

                      {economics.lossOrNoMargin && (
                        <div style={{ gridColumn: "1 / -1", padding: "8px 10px", borderRadius: "8px", background: "rgba(255, 90, 110, 0.15)", border: "1px solid #70404b", marginTop: "8px" }}>
                          <small style={{ color: "#ffb0bc", fontWeight: 800 }}>
                            ⚠️ Warning: Selling price is below estimated provider cost (negative profit). You can still save if this is intentional.
                          </small>
                        </div>
                      )}
                    </div>
                  )}

                  {!isUnitSupported && (
                    <div className="pricing-popup-unavailable">
                      ReliableSMM returned an unsupported pricing basis ({unit}). This mapping cannot be saved. Use the price-only action to change customer pricing without changing the provider.
                    </div>
                  )}
                  {isUnitSupported && isFxValid && price && !economics && (
                    <div className="pricing-popup-unavailable" role="status">
                      Economics unavailable: the entered customer price, provider rate, or FX value is invalid or exceeds supported precision.
                    </div>
                  )}
                </div>

                <div className="mapping-modal-actions">
                  <button type="button" className="mapping-cancel" onClick={() => setStep(1)}>
                    ← Back
                  </button>
                  <button
                    type="button"
                    className="mapping-confirm"
                    disabled={
                      !selected ||
                      !isUnitSupported ||
                      priceLoadState !== "loaded" ||
                      !validCustomerPrice(price) ||
                      busy
                    }
                    onClick={() => void save()}
                  >
                    {busy ? "Saving…" : "Save Customer Price & Mapping"}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
