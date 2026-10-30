"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { getPlatformLogoUrl } from "../../../lib/catalog/logo";
import { normalizePricingValue, calculatePricing, formatGhsAmount, type RateUnit } from "../../../lib/pricing/engine";
import { adminPricePer1000ToUnitRate } from "../../../lib/pricing/customer-price";
import type { AdminPlatform } from "./CreateServiceCard";
import type { BulkImportResultItem } from "../../api/admin/services/bulk/route";

// ── Types ──────────────────────────────────────────────────────────────────────

type ProviderRow = {
  provider_service_id: string;
  name: string;
  provider_rate: string | number;
  provider_currency: string;
  rate_unit: string;
  min_quantity: number;
  max_quantity: number;
  provider_status: string;
  category?: string;
  detected_platform?: string | null;
  compatibility_state?: "READY" | "MISSING_METADATA" | "UNSUPPORTED_TARGET";
  compatibility?: { platform: string; targetType: string } | null;
  mapped_service?: { name: string } | null;
  raw_metadata?: unknown;
};

function isProviderRow(v: unknown): v is ProviderRow {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.provider_service_id === "string" &&
    typeof r.name === "string" &&
    (typeof r.provider_rate === "string" || typeof r.provider_rate === "number") &&
    typeof r.provider_currency === "string" &&
    typeof r.rate_unit === "string" &&
    typeof r.min_quantity === "number" &&
    typeof r.max_quantity === "number"
  );
}

type Step = "platform_select" | "catalog_browse" | "price_config" | "confirm_import";

interface SelectedItem extends ProviderRow {
  /** Selling price per 1,000 units in GHS */
  sellingPricePer1000: string;
  /** Inferred target type */
  targetType: string;
}

interface Props {
  platforms: AdminPlatform[];
  fxRate?: string | null;
  fxError?: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const TARGET_OPTIONS = [
  ["url", "Direct / Profile URL"],
  ["post_url", "Post / Video URL"],
  ["channel", "Channel URL"],
  ["page", "Page URL"],
  ["username", "Username (@handle)"],
] as const;

function inferTargetType(row: ProviderRow): string {
  const meta =
    row.raw_metadata && typeof row.raw_metadata === "object" && !Array.isArray(row.raw_metadata)
      ? (row.raw_metadata as Record<string, unknown>)
      : {};
  const rawTarget = [meta.target_type, meta.targetType, meta.input_type, meta.inputType].find(
    (v): v is string => typeof v === "string" && v.trim().length > 0
  );
  const inferred = (row.compatibility?.targetType ?? rawTarget)?.toLowerCase();
  const allowed = TARGET_OPTIONS.find(([val]) => val === inferred)?.[0];
  if (allowed) return allowed;
  const text = `${row.name} ${row.category ?? ""}`.toLowerCase();
  if (/video|livestream|live stream/.test(text)) return "video_url";
  if (/\bpost\b|tweet|upvote|downvote|repin|repost/.test(text)) return "post_url";
  if (/\bchannel\b/.test(text)) return "channel";
  if (/\bpage\b/.test(text)) return "page";
  if (/\busername\b|@handle/.test(text)) return "username";
  return "url";
}

function providerCostEstimate(row: ProviderRow, fxRate: string): string | null {
  try {
    const result = calculatePricing({
      providerRate: normalizePricingValue(row.provider_rate),
      providerRateUnit: row.rate_unit as RateUnit,
      providerCurrency: row.provider_currency as "USD",
      fxRate: normalizePricingValue(fxRate, false),
      sellingPricePerUnit: adminPricePer1000ToUnitRate("1", false),
      sellingCurrency: "GHS",
      quantity: 1000,
    });
    return `₵${formatGhsAmount(result.providerCostGhs)}`;
  } catch {
    return null;
  }
}

function suggestPrice(row: ProviderRow, fxRate: string, marginPct: number): string {
  try {
    const result = calculatePricing({
      providerRate: normalizePricingValue(row.provider_rate),
      providerRateUnit: row.rate_unit as RateUnit,
      providerCurrency: row.provider_currency as "USD",
      fxRate: normalizePricingValue(fxRate, false),
      sellingPricePerUnit: adminPricePer1000ToUnitRate("1", false),
      sellingCurrency: "GHS",
      quantity: 1000,
    });
    const costGhs = parseFloat(String(result.providerCostGhs));
    if (!isFinite(costGhs) || costGhs <= 0) return "";
    const selling = costGhs * (1 + marginPct / 100);
    return selling.toFixed(2);
  } catch {
    return "";
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function BulkImportCard({ platforms, fxRate = null, fxError = null }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("platform_select");

  // Platform selection
  const [selectedPlatformId, setSelectedPlatformId] = useState("");

  // Catalog browsing
  const [catalogRows, setCatalogRows] = useState<ProviderRow[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [filterUnmapped, setFilterUnmapped] = useState(true);

  // Selection
  const [selected, setSelected] = useState<Map<string, SelectedItem>>(new Map());

  // Price config
  const [globalMargin, setGlobalMargin] = useState("50");
  const [priceOverrides, setPriceOverrides] = useState<Map<string, string>>(new Map());

  // Import progress
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<BulkImportResultItem[]>([]);
  const [importDone, setImportDone] = useState(false);
  const [importError, setImportError] = useState("");

  // Lock scroll when open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const currentPlatform = useMemo(() => platforms.find((p) => p.id === selectedPlatformId), [platforms, selectedPlatformId]);
  const currentPlatformLogo = currentPlatform ? getPlatformLogoUrl(currentPlatform.slug) : null;

  const filteredCatalog = useMemo(() => {
    let rows = catalogRows;
    if (filterUnmapped) rows = rows.filter((r) => !r.mapped_service);
    if (!catalogQuery) return rows;
    const q = catalogQuery.toLowerCase();
    return rows.filter((r) => `${r.name} ${r.category ?? ""} ${r.provider_service_id}`.toLowerCase().includes(q));
  }, [catalogRows, catalogQuery, filterUnmapped]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  function openModal() {
    setStep("platform_select");
    setSelectedPlatformId("");
    setCatalogRows([]);
    setCatalogQuery("");
    setFilterUnmapped(true);
    setSelected(new Map());
    setPriceOverrides(new Map());
    setGlobalMargin("50");
    setImportResults([]);
    setImportDone(false);
    setImportError("");
    setOpen(true);
  }

  async function handleSelectPlatform(platformId: string) {
    setSelectedPlatformId(platformId);
    setSelected(new Map());
    await loadCatalog(platformId);
    setStep("catalog_browse");
  }

  async function loadCatalog(platformId: string) {
    const plat = platforms.find((p) => p.id === platformId);
    setCatalogLoading(true);
    setCatalogError("");
    setCatalogRows([]);
    try {
      const url = new URL("/api/admin/provider-catalog", window.location.origin);
      url.searchParams.set("browse", "1");
      if (plat?.slug) url.searchParams.set("platform", plat.slug);
      const res = await fetch(url);
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = body && typeof body === "object" && !Array.isArray(body) && "error" in body && typeof (body as { error: unknown }).error === "string"
          ? (body as { error: string }).error
          : "Failed to load provider catalog.";
        throw new Error(msg);
      }
      if (!body || typeof body !== "object" || !("services" in body) || !Array.isArray((body as { services: unknown }).services)) {
        throw new Error("Invalid catalog response.");
      }
      const services = (body as { services: unknown[] }).services;
      setCatalogRows(services.filter(isProviderRow));
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : "Failed to load catalog.");
    } finally {
      setCatalogLoading(false);
    }
  }

  function toggleRow(row: ProviderRow) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(row.provider_service_id)) {
        next.delete(row.provider_service_id);
      } else {
        next.set(row.provider_service_id, {
          ...row,
          sellingPricePer1000: "",
          targetType: inferTargetType(row),
        });
      }
      return next;
    });
  }

  function selectAll() {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const row of filteredCatalog) {
        if (!next.has(row.provider_service_id)) {
          next.set(row.provider_service_id, {
            ...row,
            sellingPricePer1000: "",
            targetType: inferTargetType(row),
          });
        }
      }
      return next;
    });
  }

  function clearAll() {
    setSelected(new Map());
  }

  function proceedToPriceConfig() {
    // Apply margin-based suggested prices to selected items
    const margin = parseFloat(globalMargin);
    const safeMargin = isFinite(margin) && margin >= 0 ? margin : 50;
    setSelected((prev) => {
      const next = new Map(prev);
      for (const [id, item] of next) {
        const override = priceOverrides.get(id);
        if (override) continue; // keep explicit overrides
        const suggested = fxRate ? suggestPrice(item, fxRate, safeMargin) : "";
        next.set(id, { ...item, sellingPricePer1000: suggested || item.sellingPricePer1000 });
      }
      return next;
    });
    setStep("price_config");
  }

  function updateItemPrice(id: string, price: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      const item = next.get(id);
      if (item) next.set(id, { ...item, sellingPricePer1000: price });
      return next;
    });
    setPriceOverrides((prev) => new Map(prev).set(id, price));
  }

  function updateItemTargetType(id: string, tt: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      const item = next.get(id);
      if (item) next.set(id, { ...item, targetType: tt });
      return next;
    });
  }

  function applyGlobalMargin() {
    const margin = parseFloat(globalMargin);
    const safeMargin = isFinite(margin) && margin >= 0 ? margin : 50;
    setSelected((prev) => {
      const next = new Map(prev);
      for (const [id, item] of next) {
        const suggested = fxRate ? suggestPrice(item, fxRate, safeMargin) : "";
        next.set(id, { ...item, sellingPricePer1000: suggested || item.sellingPricePer1000 });
      }
      return next;
    });
    // Clear overrides so global applies
    setPriceOverrides(new Map());
  }

  async function runImport() {
    setImporting(true);
    setImportError("");
    setImportResults([]);

    try {
      const items = Array.from(selected.values()).map((item) => {
        const meta =
          item.raw_metadata && typeof item.raw_metadata === "object" && !Array.isArray(item.raw_metadata)
            ? (item.raw_metadata as Record<string, unknown>)
            : {};
        const providerCategory = ((item.category ?? (typeof meta.category === "string" ? meta.category : "")) as string).trim();
        return {
          providerServiceId: item.provider_service_id,
          platformId: selectedPlatformId,
          name: item.name,
          category: providerCategory || "Standard",
          description: "",
          serviceType: "standard",
          targetType: item.targetType,
          minQuantity: String(item.min_quantity || 100),
          maxQuantity: String(item.max_quantity || 100000),
          sellingPricePer1000: item.sellingPricePer1000,
          currency: "GHS",
        };
      });

      const res = await fetch("/api/admin/services/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });

      const body: unknown = await res.json().catch(() => null);
      if (!body || typeof body !== "object" || !("results" in body) || !Array.isArray((body as { results: unknown }).results)) {
        throw new Error("Import returned an unexpected response.");
      }
      setImportResults((body as { results: BulkImportResultItem[] }).results);
      setImportDone(true);
      router.refresh();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const successCount = importResults.filter((r) => r.status === "success").length;
  const errorCount = importResults.filter((r) => r.status === "error").length;

  return (
    <>
      <button
        type="button"
        className="mapping-confirm bulk-import-trigger"
        onClick={openModal}
        title="Import multiple services from provider catalog at once"
      >
        📦 Bulk Import from Catalog
      </button>

      {open &&
        createPortal(
          <div
            className="create-service-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Bulk Import Services"
            onClick={(e) => { if (e.target === e.currentTarget && !importing) setOpen(false); }}
          >
            <div className="create-service-modal" style={{ maxWidth: "720px", maxHeight: "90vh", overflowY: "auto" }}>
              {/* Header */}
              <div className="create-service-header">
                <div>
                  <p className="dashboard-kicker">BULK IMPORT</p>
                  <h2>Import from Provider Catalog</h2>
                  <p style={{ color: "#a99bb2", margin: 0 }}>
                    Select multiple services, set a price margin, and import them all at once.
                  </p>
                </div>
                {!importing && (
                  <button
                    type="button"
                    className="create-service-close"
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Step indicator */}
              <div style={{ display: "flex", gap: "8px", padding: "12px 0", margin: "0 0 16px", borderBottom: "1px solid #2d1b3d" }}>
                {(["platform_select", "catalog_browse", "price_config", "confirm_import"] as Step[]).map((s, i) => {
                  const labels = ["1. Platform", "2. Select Services", "3. Set Prices", "4. Import"];
                  const isActive = step === s;
                  const isDone = (
                    step === "catalog_browse" && i === 0 ||
                    step === "price_config" && i <= 1 ||
                    step === "confirm_import" && i <= 2
                  );
                  return (
                    <span
                      key={s}
                      style={{
                        fontSize: "12px",
                        fontWeight: isActive ? 800 : isDone ? 600 : 400,
                        color: isActive ? "#e8d5ff" : isDone ? "#9b7fc4" : "#4a3560",
                        padding: "4px 10px",
                        borderRadius: "6px",
                        background: isActive ? "#2d1b3d" : "transparent",
                      }}
                    >
                      {isDone && !isActive ? "✓ " : ""}{labels[i]}
                    </span>
                  );
                })}
              </div>

              {/* ── Step 1: Platform Selection ── */}
              {step === "platform_select" && (
                <div>
                  <p style={{ color: "#a99bb2", marginBottom: "16px" }}>Which platform do you want to import services for?</p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "10px" }}>
                    {platforms.map((platform) => {
                      const logoUrl = getPlatformLogoUrl(platform.slug);
                      return (
                        <button
                          key={platform.id}
                          type="button"
                          className="platform-option"
                          onClick={() => handleSelectPlatform(platform.id)}
                          style={{ textAlign: "left" }}
                        >
                          <span className="platform-option-logo">
                            {logoUrl ? <img src={logoUrl} alt="" /> : platform.logo || platform.name.slice(0, 2)}
                          </span>
                          <span className="platform-option-name">{platform.name}</span>
                          {platform.servicesCount !== undefined && (
                            <small style={{ color: "#7b5f9a", display: "block", marginTop: "2px" }}>
                              {platform.servicesCount} services
                            </small>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {platforms.length === 0 && (
                    <p style={{ color: "#7b5f9a" }}>No active platforms. Create a platform first.</p>
                  )}
                </div>
              )}

              {/* ── Step 2: Catalog Browse & Select ── */}
              {step === "catalog_browse" && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
                    {currentPlatformLogo && <img src={currentPlatformLogo} alt="" style={{ width: 24, height: 24 }} />}
                    <strong>{currentPlatform?.name} — Provider Catalog</strong>
                    <span style={{ marginLeft: "auto", color: "#9b7fc4", fontSize: "13px" }}>
                      {selected.size} selected
                    </span>
                  </div>

                  {/* Filters */}
                  <div style={{ display: "flex", gap: "10px", marginBottom: "10px", flexWrap: "wrap", alignItems: "center" }}>
                    <input
                      className="admin-input"
                      type="search"
                      placeholder="Search by name, category, ID…"
                      value={catalogQuery}
                      onChange={(e) => setCatalogQuery(e.target.value)}
                      style={{ flex: 1, minWidth: "160px" }}
                    />
                    <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#c4b0d8", cursor: "pointer", userSelect: "none" }}>
                      <input
                        type="checkbox"
                        checked={filterUnmapped}
                        onChange={(e) => setFilterUnmapped(e.target.checked)}
                      />
                      Unmapped only
                    </label>
                    <button type="button" className="admin-btn-ghost" onClick={selectAll} style={{ fontSize: "12px" }}>Select all visible</button>
                    <button type="button" className="admin-btn-ghost" onClick={clearAll} style={{ fontSize: "12px" }}>Clear</button>
                  </div>

                  {catalogLoading && <p style={{ color: "#9b7fc4" }}>Loading catalog…</p>}
                  {catalogError && <p style={{ color: "#e85d75" }}>⚠ {catalogError}</p>}

                  {!catalogLoading && !catalogError && (
                    <div style={{ maxHeight: "360px", overflowY: "auto", border: "1px solid #2d1b3d", borderRadius: "8px" }}>
                      {filteredCatalog.length === 0 ? (
                        <p style={{ padding: "20px", color: "#7b5f9a", textAlign: "center" }}>No catalog services match your filters.</p>
                      ) : filteredCatalog.map((row) => {
                        const isChecked = selected.has(row.provider_service_id);
                        const cost = fxRate ? providerCostEstimate(row, fxRate) : null;
                        return (
                          <label
                            key={row.provider_service_id}
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              gap: "10px",
                              padding: "10px 14px",
                              borderBottom: "1px solid #1e0f2e",
                              cursor: "pointer",
                              background: isChecked ? "#1e0e30" : "transparent",
                              transition: "background 0.1s",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleRow(row)}
                              style={{ marginTop: "3px", flexShrink: 0 }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                                <span style={{ fontWeight: 600, fontSize: "13px", color: "#e8d5ff" }}>{row.name}</span>
                                <span style={{ fontSize: "12px", color: "#7b5f9a", flexShrink: 0 }}>#{row.provider_service_id}</span>
                              </div>
                              <div style={{ display: "flex", gap: "12px", marginTop: "3px", flexWrap: "wrap" }}>
                                {row.category && <small style={{ color: "#9b7fc4" }}>{row.category}</small>}
                                <small style={{ color: "#6b4f88" }}>
                                  ${typeof row.provider_rate === "number" ? row.provider_rate.toFixed(4) : row.provider_rate} USD / 1k
                                  {cost && <span style={{ color: "#b8a0d0" }}> ≈ {cost}</span>}
                                </small>
                                <small style={{ color: "#6b4f88" }}>{row.min_quantity.toLocaleString()}–{row.max_quantity.toLocaleString()}</small>
                                {row.mapped_service && (
                                  <small style={{ color: "#e85d75" }}>⚠ Already mapped: {row.mapped_service.name}</small>
                                )}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: "16px", alignItems: "center" }}>
                    <button type="button" className="admin-btn-ghost" onClick={() => setStep("platform_select")}>← Back</button>
                    <button
                      type="button"
                      className="mapping-confirm"
                      disabled={selected.size === 0}
                      onClick={() => setStep("price_config")}
                    >
                      Set prices for {selected.size} service{selected.size !== 1 ? "s" : ""} →
                    </button>
                  </div>
                </div>
              )}

              {/* ── Step 3: Price Configuration ── */}
              {step === "price_config" && (
                <div>
                  {/* Global margin */}
                  <div style={{ background: "#1a0d2e", border: "1px solid #2d1b3d", borderRadius: "10px", padding: "14px 18px", marginBottom: "18px" }}>
                    <p style={{ margin: "0 0 10px", fontWeight: 700, color: "#c4b0d8" }}>Global Margin Setting</p>
                    <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                      {fxRate ? (
                        <>
                          <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "#a99bb2", fontSize: "13px" }}>
                            Markup over provider cost:
                            <input
                              className="admin-input"
                              type="number"
                              min="0"
                              max="10000"
                              step="5"
                              value={globalMargin}
                              onChange={(e) => setGlobalMargin(e.target.value)}
                              style={{ width: "80px" }}
                            />
                            %
                          </label>
                          <button type="button" className="mapping-confirm" onClick={applyGlobalMargin} style={{ padding: "6px 14px", fontSize: "13px" }}>
                            Apply to all
                          </button>
                        </>
                      ) : (
                        <p style={{ color: "#e85d75", margin: 0, fontSize: "13px" }}>
                          ⚠ FX rate not configured{fxError ? `: ${fxError}` : ""}. Set prices manually below.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Per-item overrides */}
                  <div style={{ maxHeight: "380px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
                    {Array.from(selected.values()).map((item) => {
                      const cost = fxRate ? providerCostEstimate(item, fxRate) : null;
                      return (
                        <div
                          key={item.provider_service_id}
                          style={{ background: "#1a0d2e", border: "1px solid #2d1b3d", borderRadius: "8px", padding: "12px 14px" }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                            <span style={{ fontWeight: 600, fontSize: "13px", color: "#e8d5ff" }}>{item.name}</span>
                            <span style={{ fontSize: "12px", color: "#6b4f88" }}>#{item.provider_service_id}</span>
                          </div>
                          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#a99bb2" }}>
                              Sell price / 1k (₵):
                              <input
                                className="admin-input"
                                type="number"
                                min="0.01"
                                step="0.01"
                                placeholder={cost ? cost.replace("₵", "") : "0.00"}
                                value={item.sellingPricePer1000}
                                onChange={(e) => updateItemPrice(item.provider_service_id, e.target.value)}
                                style={{ width: "90px" }}
                              />
                            </label>
                            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#a99bb2" }}>
                              Input type:
                              <select
                                className="admin-select"
                                value={item.targetType}
                                onChange={(e) => updateItemTargetType(item.provider_service_id, e.target.value)}
                              >
                                {TARGET_OPTIONS.map(([val, label]) => (
                                  <option key={val} value={val}>{label}</option>
                                ))}
                              </select>
                            </label>
                            {cost && (
                              <small style={{ color: "#7b5f9a" }}>Cost ≈ {cost} / 1k</small>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: "16px" }}>
                    <button type="button" className="admin-btn-ghost" onClick={() => setStep("catalog_browse")}>← Back</button>
                    <button
                      type="button"
                      className="mapping-confirm"
                      disabled={Array.from(selected.values()).some((i) => !i.sellingPricePer1000 || parseFloat(i.sellingPricePer1000) <= 0)}
                      onClick={() => setStep("confirm_import")}
                    >
                      Review & Import →
                    </button>
                  </div>
                </div>
              )}

              {/* ── Step 4: Confirm & Import ── */}
              {step === "confirm_import" && (
                <div>
                  {!importDone ? (
                    <>
                      <p style={{ color: "#a99bb2", marginBottom: "12px" }}>
                        About to import <strong style={{ color: "#e8d5ff" }}>{selected.size} service{selected.size !== 1 ? "s" : ""}</strong> under <strong style={{ color: "#e8d5ff" }}>{currentPlatform?.name}</strong>.
                        Each will be created as <em>inactive</em> (hidden from customers) so you can review before publishing.
                      </p>

                      {/* Summary table */}
                      <div style={{ maxHeight: "300px", overflowY: "auto", border: "1px solid #2d1b3d", borderRadius: "8px", marginBottom: "16px" }}>
                        {Array.from(selected.values()).map((item) => (
                          <div
                            key={item.provider_service_id}
                            style={{ display: "flex", justifyContent: "space-between", padding: "9px 14px", borderBottom: "1px solid #1e0f2e", fontSize: "13px" }}
                          >
                            <span style={{ color: "#c4b0d8" }}>{item.name}</span>
                            <span style={{ color: "#9b7fc4" }}>₵{item.sellingPricePer1000} / 1k · {item.targetType}</span>
                          </div>
                        ))}
                      </div>

                      {importing && (
                        <p style={{ color: "#9b7fc4", marginBottom: "10px" }}>
                          ⏳ Importing… please wait
                        </p>
                      )}
                      {importError && (
                        <p style={{ color: "#e85d75", marginBottom: "10px" }}>⚠ {importError}</p>
                      )}

                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <button
                          type="button"
                          className="admin-btn-ghost"
                          disabled={importing}
                          onClick={() => setStep("price_config")}
                        >
                          ← Back
                        </button>
                        <button
                          type="button"
                          className="mapping-confirm"
                          disabled={importing}
                          onClick={runImport}
                        >
                          {importing ? "Importing…" : `Import ${selected.size} service${selected.size !== 1 ? "s" : ""}`}
                        </button>
                      </div>
                    </>
                  ) : (
                    /* Results summary */
                    <div>
                      <div style={{
                        display: "flex",
                        gap: "12px",
                        marginBottom: "16px",
                        padding: "14px",
                        background: successCount > 0 ? "#0e2a1c" : "#2a0e1c",
                        border: `1px solid ${successCount > 0 ? "#1a5c34" : "#5c1a2e"}`,
                        borderRadius: "10px",
                      }}>
                        <div>
                          {successCount > 0 && <p style={{ margin: "0 0 4px", color: "#4cce8a", fontWeight: 700 }}>✓ {successCount} imported successfully</p>}
                          {errorCount > 0 && <p style={{ margin: 0, color: "#e85d75", fontWeight: 700 }}>✗ {errorCount} failed</p>}
                        </div>
                      </div>

                      <div style={{ maxHeight: "300px", overflowY: "auto", border: "1px solid #2d1b3d", borderRadius: "8px", marginBottom: "16px" }}>
                        {importResults.map((r) => (
                          <div
                            key={r.providerServiceId}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "flex-start",
                              padding: "9px 14px",
                              borderBottom: "1px solid #1e0f2e",
                              fontSize: "13px",
                              gap: "8px",
                            }}
                          >
                            <span style={{ color: r.status === "success" ? "#4cce8a" : "#e85d75" }}>
                              {r.status === "success" ? "✓" : "✗"}
                            </span>
                            <span style={{ flex: 1, color: "#c4b0d8" }}>{r.name}</span>
                            <span style={{ color: r.status === "success" ? "#4cce8a" : "#e85d75", fontSize: "12px" }}>
                              {r.status === "success"
                                ? r.autoProvisioned
                                  ? "⚡ Auto-configured"
                                  : "Created"
                                : r.error}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                        {errorCount > 0 && (
                          <button
                            type="button"
                            className="admin-btn-ghost"
                            onClick={() => {
                              // Keep only failed items
                              const failed = new Map(
                                importResults
                                  .filter((r) => r.status === "error")
                                  .flatMap((r) => {
                                    const item = selected.get(r.providerServiceId);
                                    return item ? [[r.providerServiceId, item] as [string, SelectedItem]] : [];
                                  })
                              );
                              setSelected(failed);
                              setImportResults([]);
                              setImportDone(false);
                              setStep("price_config");
                            }}
                          >
                            Retry {errorCount} failed
                          </button>
                        )}
                        <button
                          type="button"
                          className="mapping-confirm"
                          onClick={() => setOpen(false)}
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
