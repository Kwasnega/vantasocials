"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { getPlatformLogoUrl } from "../../../lib/catalog/logo";
import { calculatePricing, formatGhsAmount, normalizePricingValue, type RateUnit } from "../../../lib/pricing/engine";
import { adminPricePer1000ToUnitRate } from "../../../lib/pricing/customer-price";

export type AdminPlatform = {
  id: string;
  name: string;
  slug: string;
  logo: string;
  color: string;
  description?: string | null;
  servicesCount?: number;
};

type ProviderRow = {
  provider_service_id: string;
  name: string;
  provider_rate: string | number;
  provider_currency: string;
  rate_unit: string;
  min_quantity: number;
  max_quantity: number;
  refill_supported: boolean;
  cancel_supported: boolean;
  provider_status: string;
  last_synced_at?: string | null;
  compatibility_state?: "READY" | "MISSING_METADATA" | "UNSUPPORTED_TARGET";
  compatibility?: { platform: string; targetType: string } | null;
  compatibility_reason?: string | null;
  mapped_service?: { name: string } | null;
};

// Known platforms offered by ReliableSMM / supported providers
const PROVIDER_SUPPORTED_PLATFORMS = [
  { name: "Instagram", slug: "instagram", color: "#E4405F", description: "Followers, Likes, Views & Comments" },
  { name: "TikTok", slug: "tiktok", color: "#00F2FE", description: "Followers, Likes, Views & Shares" },
  { name: "YouTube", slug: "youtube", color: "#FF0000", description: "Subscribers, Views, Likes & Comments" },
  { name: "Facebook", slug: "facebook", color: "#1877F2", description: "Followers, Page Likes, Post Likes & Views" },
  { name: "X / Twitter", slug: "x", color: "#FFFFFF", description: "Followers, Likes, Reposts & Views" },
  { name: "Telegram", slug: "telegram", color: "#26A5E4", description: "Channel Members, Post Views & Reactions" },
  { name: "LinkedIn", slug: "linkedin", color: "#0A66C2", description: "Connections, Followers & Post Reactions" },
  { name: "Spotify", slug: "spotify", color: "#1DB954", description: "Plays, Followers & Monthly Listeners" },
  { name: "Kick", slug: "kick", color: "#53FC18", description: "Followers & Live Stream Viewers" },
  { name: "Discord", slug: "discord", color: "#5865F2", description: "Server Members & Online Boosts" },
  { name: "Twitch", slug: "twitch", color: "#9146FF", description: "Followers, Views & Live Viewers" },
  { name: "Pinterest", slug: "pinterest", color: "#E60023", description: "Followers, Repins & Board Likes" },
  { name: "Snapchat", slug: "snapchat", color: "#FFFC00", description: "Followers, Views & Spotlight Upvotes" },
  { name: "Reddit", slug: "reddit", color: "#FF4500", description: "Upvotes, Post Karma & Community Members" },
  { name: "SoundCloud", slug: "soundcloud", color: "#FF5500", description: "Plays, Followers & Reposts" },
  { name: "Threads", slug: "threads", color: "#FFFFFF", description: "Followers, Likes & Reposts" },
];

const TARGET_OPTIONS = [
  ["url", "Direct URL / Profile URL (Recommended)"],
  ["post_url", "Post / Video URL"],
  ["channel", "Channel / Profile URL"],
  ["page", "Page URL"],
  ["username", "Username (@handle)"],
];

interface CreateServiceCardProps {
  platforms: AdminPlatform[];
  defaultPlatformId?: string;
  triggerLabel?: string;
  triggerClassName?: string;
  fxRate?: string | null;
  fxError?: string | null;
  fxUpdatedAt?: string | null;
  fxSource?: string | null;
}

export function CreateServiceCard({
  platforms,
  defaultPlatformId,
  triggerLabel = "+ Add New Service",
  triggerClassName = "mapping-confirm create-service-trigger",
  fxRate = null,
  fxError = null,
  fxUpdatedAt = null,
  fxSource = null,
}: CreateServiceCardProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"platform_select" | "service_form" | "new_platform">(
    defaultPlatformId ? "service_form" : "platform_select"
  );
  const [selectedPlatformId, setSelectedPlatformId] = useState<string>(defaultPlatformId || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [createdInfo, setCreatedInfo] = useState<{ name: string; platformName: string; mapped: boolean } | null>(null);

  // Optional provider catalog browsing
  const [browseCatalog, setBrowseCatalog] = useState(false);
  const [catalogRows, setCatalogRows] = useState<ProviderRow[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [selectedProviderRow, setSelectedProviderRow] = useState<ProviderRow | null>(null);

  // Form states
  const [serviceName, setServiceName] = useState("");
  const [category, setCategory] = useState("Standard");
  const [targetType, setTargetType] = useState("url");
  const [minQty, setMinQty] = useState("100");
  const [maxQty, setMaxQty] = useState("50000");
  const [sellingRate, setSellingRate] = useState("");
  const [description, setDescription] = useState("");

  // New platform form states (selected from provider catalog list)
  const [selectedProviderPlatform, setSelectedProviderPlatform] = useState(PROVIDER_SUPPORTED_PLATFORMS[0].name);
  const [newPlatformName, setNewPlatformName] = useState(PROVIDER_SUPPORTED_PLATFORMS[0].name);
  const [newPlatformColor, setNewPlatformColor] = useState(PROVIDER_SUPPORTED_PLATFORMS[0].color);
  const [newPlatformDesc, setNewPlatformDesc] = useState(PROVIDER_SUPPORTED_PLATFORMS[0].description);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const currentPlatform = useMemo(
    () => platforms.find((p) => p.id === selectedPlatformId),
    [platforms, selectedPlatformId]
  );
  const currentPlatformLogo = currentPlatform
    ? getPlatformLogoUrl(currentPlatform.slug)
    : null;

  // Filter catalog rows to ONLY show services for the active platform
  const filteredCatalog = useMemo(() => {
    let list = catalogRows;
    if (currentPlatform?.slug) {
      const pSlug = currentPlatform.slug.toLowerCase();
      list = list.filter((r) => {
        const plat = r.compatibility?.platform?.toLowerCase();
        if (plat) {
          if (pSlug === "x" && (plat === "twitter" || plat === "x")) return true;
          if (plat === pSlug) return true;
        }
        const text = `${r.name} ${r.provider_service_id}`.toLowerCase();
        if (pSlug === "x") return text.includes("twitter") || text.includes("tweet") || text.includes(" x ");
        return text.includes(pSlug);
      });
    }
    if (!catalogQuery) return list;
    const q = catalogQuery.toLowerCase();
    return list.filter(
      (r) => r.name.toLowerCase().includes(q) || r.provider_service_id.includes(q)
    );
  }, [catalogRows, catalogQuery, currentPlatform]);

  const creationEconomics = useMemo(() => {
    const unit = selectedProviderRow?.rate_unit;
    if (!selectedProviderRow || !fxRate || (unit !== "PER_1000" && unit !== "PER_ORDER") || selectedProviderRow.provider_currency !== "USD") return null;
    try {
      const inputs = {
        providerRate: normalizePricingValue(selectedProviderRow.provider_rate),
        providerRateUnit: unit as RateUnit,
        providerCurrency: "USD" as const,
        fxRate: normalizePricingValue(fxRate, false),
        sellingPricePerUnit: adminPricePer1000ToUnitRate(sellingRate, false),
        sellingCurrency: "GHS" as const,
      };
      return {
        per1000: calculatePricing({ ...inputs, quantity: 1000 }),
        per10000: calculatePricing({ ...inputs, quantity: 10000 }),
      };
    } catch {
      return null;
    }
  }, [selectedProviderRow, fxRate, sellingRate]);

  function openModal(platformId?: string) {
    setMessage("");
    setCreatedInfo(null);
    setSelectedProviderRow(null);
    setBrowseCatalog(false);
    if (platformId) {
      setSelectedPlatformId(platformId);
      setMode("service_form");
    } else if (defaultPlatformId) {
      setSelectedPlatformId(defaultPlatformId);
      setMode("service_form");
    } else {
      setSelectedPlatformId("");
      setMode("platform_select");
    }
    setOpen(true);
  }

  function handleSelectPlatform(platformId: string) {
    setSelectedPlatformId(platformId);
    setTargetType("url");
    setMode("service_form");
  }

  async function loadProviderCatalog() {
    setBrowseCatalog(true);
    if (catalogRows.length > 0) return;
    setCatalogLoading(true);
    try {
      const pSlug = currentPlatform?.slug ? `&platform=${encodeURIComponent(currentPlatform.slug)}` : "";
      const res = await fetch(`/api/admin/provider-catalog?browse=1${pSlug}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load provider catalog.");
      setCatalogRows(data.services || []);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to load catalog.");
    } finally {
      setCatalogLoading(false);
    }
  }

  function handleSelectProviderRow(row: ProviderRow) {
    setSelectedProviderRow(row);
    if (!serviceName) setServiceName(row.name);
    if (row.min_quantity) setMinQty(String(row.min_quantity));
    if (row.max_quantity) setMaxQty(String(row.max_quantity));
    setTargetType("url");
    setBrowseCatalog(false);
  }

  function handleProviderPlatformChange(platformName: string) {
    setSelectedProviderPlatform(platformName);
    const found = PROVIDER_SUPPORTED_PLATFORMS.find((p) => p.name === platformName);
    if (found) {
      setNewPlatformName(found.name);
      setNewPlatformColor(found.color);
      setNewPlatformDesc(found.description);
    }
  }

  async function handleCreateService(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPlatformId) {
      setMessage("Please select a platform first.");
      return;
    }
    setBusy(true);
    setMessage("");

    try {
      const payload: Record<string, unknown> = {
        platformId: selectedPlatformId,
        name: serviceName.trim(),
        category: category.trim() || "Standard",
        targetType,
        minQuantity: minQty,
        maxQuantity: maxQty,
        sellingPricePer1000: sellingRate.trim(),
        currency: "GHS",
        description: description.trim(),
        serviceType: "standard",
      };

      const providerMappingRequested = Boolean(
        selectedProviderRow &&
        (selectedProviderRow.rate_unit === "PER_1000" || selectedProviderRow.rate_unit === "PER_ORDER")
      );
      const selectedProviderServiceId = selectedProviderRow?.provider_service_id;
      if (providerMappingRequested && selectedProviderRow) {
        payload.providerServiceId = selectedProviderRow.provider_service_id;
      }

      const res = await fetch("/api/admin/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || "Failed to create service.");
      }
      const mapped = Boolean(
        providerMappingRequested &&
        selectedProviderServiceId &&
        body.mapping?.provider === "reliablesmm" &&
        String(body.mapping?.provider_service_id ?? "") === selectedProviderServiceId &&
        body.service?.provider === "reliablesmm" &&
        String(body.service?.provider_service_id ?? "") === selectedProviderServiceId
      );
      if (selectedProviderRow && !mapped) {
        throw new Error("Service creation returned without a verified provider mapping. Check the service before retrying.");
      }

      setCreatedInfo({
        name: serviceName,
        platformName: currentPlatform?.name || "Platform",
        mapped,
      });

      // Clear fields
      setServiceName("");
      setSellingRate("");
      setDescription("");
      setSelectedProviderRow(null);

      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Error creating service.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreatePlatform(e: React.FormEvent) {
    e.preventDefault();
    if (!newPlatformName.trim()) {
      setMessage("Platform name is required.");
      return;
    }
    setBusy(true);
    setMessage("");

    try {
      const res = await fetch("/api/admin/platforms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newPlatformName.trim(),
          color: newPlatformColor,
          description: newPlatformDesc.trim(),
        }),
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || "Failed to create platform.");
      }

      router.refresh();
      setOpen(false);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Error creating platform.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => openModal(defaultPlatformId)}
      >
        {triggerLabel}
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className="mapping-modal-backdrop">
          <section className="mapping-modal create-service-modal" role="dialog" aria-modal="true">
            <header className="mapping-modal-header">
              <div>
                <p className="dashboard-kicker">
                  {mode === "platform_select"
                    ? "STEP 1: SELECT PLATFORM"
                    : mode === "new_platform"
                    ? "NEW PLATFORM CARD"
                    : `STEP 2: ADD SERVICE TO ${currentPlatform?.name?.toUpperCase() ?? "PLATFORM"}`}
                </p>
                <h2>
                  {mode === "platform_select"
                    ? "Choose Social Media Platform"
                    : mode === "new_platform"
                    ? "Add Provider Platform"
                    : `Configure ${currentPlatform?.name ?? ""} Service`}
                </h2>
                <p>
                  {mode === "platform_select"
                    ? "Pick the platform card to add services under."
                    : mode === "new_platform"
                    ? "Select a social media network that ReliableSMM provider supports."
                    : "Fill in service details. The service will be created directly under this platform card."}
                </p>
              </div>
              <button
                type="button"
                className="mapping-modal-close"
                onClick={() => !busy && setOpen(false)}
                aria-label="Close modal"
              >
                ×
              </button>
            </header>

            {message && (
              <p className="mapping-message" role="alert" style={{ margin: "16px 30px 0" }}>
                {message}
              </p>
            )}

            {createdInfo ? (
              <div style={{ padding: "36px 30px", textAlign: "center" }}>
                <div style={{ fontSize: "40px", marginBottom: "12px", color: "#78dfb4" }}>✓</div>
                <h3 style={{ margin: "0 0 8px", color: "#fff" }}>Service Created!</h3>
                <p style={{ color: "#a99bb2", margin: "0 0 24px" }}>
                  <strong>{createdInfo.name}</strong> has been created and added to the{" "}
                  <strong>{createdInfo.platformName}</strong> card.
                  {createdInfo.mapped ? " The provider mapping was saved and verified; the service remains inactive." : ""}
                  {!createdInfo.mapped ? " The service was created without a provider mapping and can be mapped later." : ""}
                </p>
                <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
                  <button
                    type="button"
                    className="mapping-confirm"
                    onClick={() => {
                      setCreatedInfo(null);
                      setMode("service_form");
                    }}
                  >
                    + Add Another Service
                  </button>
                  <button
                    type="button"
                    className="mapping-cancel"
                    onClick={() => setOpen(false)}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : mode === "platform_select" ? (
              /* Step 1: Platform Selection */
              <div className="create-service-platform-select">
                <div className="create-service-platform-grid">
                  {platforms.map((p) => {
                    const logoUrl = getPlatformLogoUrl(p.slug);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleSelectPlatform(p.id)}
                        className="mapping-option"
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "20px 14px",
                          gap: "10px",
                          borderRadius: "16px",
                          cursor: "pointer",
                          border: "1px solid #352548",
                          background: "linear-gradient(145deg, #1f122e, #130920)",
                          textAlign: "center",
                        }}
                      >
                        <span
                          style={{
                            width: "44px",
                            height: "44px",
                            borderRadius: "12px",
                            display: "grid",
                            placeItems: "center",
                            background: p.color ? `${p.color}25` : "#321d4a",
                            border: `1px solid ${p.color ? `${p.color}60` : "#4b2a70"}`,
                          }}
                        >
                          {logoUrl ? (
                            <img
                              src={logoUrl}
                              alt={p.name}
                              style={{ width: "24px", height: "24px", objectFit: "contain" }}
                            />
                          ) : (
                            <strong style={{ color: p.color || "#d883ff" }}>
                              {p.logo || p.name.slice(0, 2)}
                            </strong>
                          )}
                        </span>
                        <strong style={{ color: "#fff", fontSize: "16px" }}>{p.name}</strong>
                        <small style={{ color: "#a99bb2" }}>
                          {p.servicesCount ?? 0} {p.servicesCount === 1 ? "service" : "services"}
                        </small>
                      </button>
                    );
                  })}

                  {/* Add New Platform Card */}
                  <button
                    type="button"
                    onClick={() => setMode("new_platform")}
                    className="mapping-option"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "20px 14px",
                      gap: "10px",
                      borderRadius: "16px",
                      cursor: "pointer",
                      border: "1px dashed #7a4bb5",
                      background: "rgba(122, 75, 181, 0.08)",
                      textAlign: "center",
                    }}
                  >
                    <span
                      style={{
                        width: "44px",
                        height: "44px",
                        borderRadius: "12px",
                        display: "grid",
                        placeItems: "center",
                        background: "#321d4a",
                        color: "#d883ff",
                        fontSize: "22px",
                        fontWeight: 900,
                      }}
                    >
                      +
                    </span>
                    <strong style={{ color: "#d883ff", fontSize: "15px" }}>New Platform</strong>
                    <small style={{ color: "#8a7a99" }}>From provider catalog</small>
                  </button>
                </div>
              </div>
            ) : mode === "new_platform" ? (
              /* New Platform Creation from Provider Catalog */
              <form onSubmit={handleCreatePlatform} style={{ padding: "20px 30px 26px" }}>
                <div style={{ display: "grid", gap: "16px" }}>
                  <label>
                    Select Platform (from Provider Catalog)
                    <select
                      value={selectedProviderPlatform}
                      onChange={(e) => handleProviderPlatformChange(e.target.value)}
                      style={{
                        padding: "12px 14px",
                        borderRadius: "10px",
                        border: "1px solid #4a315b",
                        background: "#120a1d",
                        color: "#fff",
                        fontSize: "14px",
                        fontWeight: 600,
                      }}
                    >
                      {PROVIDER_SUPPORTED_PLATFORMS.map((p) => {
                        const exists = platforms.some(
                          (ep) => ep.slug.toLowerCase() === p.slug.toLowerCase() || ep.name.toLowerCase() === p.name.toLowerCase()
                        );
                        return (
                          <option key={p.slug} value={p.name}>
                            {p.name} {exists ? "✓ (Already in catalog)" : "★ (Available to add)"}
                          </option>
                        );
                      })}
                    </select>
                  </label>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: "12px" }}>
                    <label>
                      Platform Display Name
                      <input
                        required
                        value={newPlatformName}
                        onChange={(e) => setNewPlatformName(e.target.value)}
                      />
                    </label>
                    <label>
                      Theme Color
                      <input
                        type="color"
                        value={newPlatformColor}
                        onChange={(e) => setNewPlatformColor(e.target.value)}
                        style={{ height: "46px", padding: "4px 8px", cursor: "pointer", width: "100%" }}
                      />
                    </label>
                  </div>

                  <label>
                    Description
                    <textarea
                      placeholder="Short description for this platform"
                      value={newPlatformDesc}
                      onChange={(e) => setNewPlatformDesc(e.target.value)}
                      rows={2}
                    />
                  </label>
                </div>

                <div className="mapping-modal-actions" style={{ padding: "20px 0 0" }}>
                  <button
                    type="button"
                    className="mapping-cancel"
                    onClick={() => setMode("platform_select")}
                    disabled={busy}
                  >
                    ← Back to Platforms
                  </button>
                  <button type="submit" className="mapping-confirm" disabled={busy}>
                    {busy ? "Creating…" : "Create Platform Card"}
                  </button>
                </div>
              </form>
            ) : (
              /* Step 2: Service Configuration */
              <form
                onSubmit={handleCreateService}
                className="create-service-form"
              >
                {/* Platform Badge Bar */}
                <div className="create-service-platform-banner">
                  <div className="create-service-platform-banner-inner">
                    <span
                      className="create-service-platform-badge"
                      style={{
                        background: currentPlatform?.color || "#d883ff",
                      }}
                    >
                      {currentPlatformLogo && (
                        <img
                          src={currentPlatformLogo}
                          alt=""
                          aria-hidden="true"
                          style={{
                            width: 18,
                            height: 18,
                            padding: 2,
                            boxSizing: "border-box",
                            objectFit: "contain",
                            borderRadius: 4,
                            background: "#21152d",
                            marginRight: 6,
                          }}
                        />
                      )}
                      {currentPlatform?.name}
                    </span>
                    <span className="create-service-platform-copy">
                      New service will be added to this card
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMode("platform_select")}
                    className="create-service-platform-switch"
                  >
                    Change Platform
                  </button>
                </div>

                {/* Optional Provider Linking Scoped to Current Platform */}
                <div style={{ marginBottom: "18px" }}>
                  {!browseCatalog ? (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 14px",
                        borderRadius: "10px",
                        background: "#180d24",
                        border: "1px solid #352548",
                      }}
                    >
                      <span style={{ fontSize: "13px", color: "#a99bb2" }}>
                        {selectedProviderRow ? (
                          <>
                            Linked to: <strong>#{selectedProviderRow.provider_service_id}</strong>{" "}
                            ({selectedProviderRow.name})
                          </>
                        ) : (
                          `Browse ${currentPlatform?.name ?? "Provider"} Catalog Services (Optional)`
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={loadProviderCatalog}
                        style={{
                          background: "#28143a",
                          border: "1px solid #553472",
                          color: "#d883ff",
                          borderRadius: "8px",
                          padding: "6px 12px",
                          cursor: "pointer",
                          fontSize: "12px",
                          fontWeight: 800,
                        }}
                      >
                        {selectedProviderRow ? "Change" : `Browse ${currentPlatform?.name ?? ""} Catalog`}
                      </button>
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: "14px",
                        borderRadius: "12px",
                        background: "#160a22",
                        border: "1px solid #4a2d68",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "10px",
                        }}
                      >
                        <strong style={{ fontSize: "13px", color: "#fff" }}>
                          Select {currentPlatform?.name} Service from ReliableSMM
                        </strong>
                        <button
                          type="button"
                          onClick={() => setBrowseCatalog(false)}
                          style={{
                            background: "transparent",
                            border: "0",
                            color: "#a99bb2",
                            cursor: "pointer",
                          }}
                        >
                          ✕ Close
                        </button>
                      </div>
                      <input
                        placeholder={`Search ${currentPlatform?.name ?? ""} services...`}
                        value={catalogQuery}
                        onChange={(e) => setCatalogQuery(e.target.value)}
                        style={{
                          width: "100%",
                          marginBottom: "10px",
                          padding: "8px 12px",
                          borderRadius: "8px",
                          border: "1px solid #352548",
                          background: "#0f0717",
                          color: "#fff",
                        }}
                      />
                      <div style={{ maxHeight: "200px", overflowY: "auto", display: "grid", gap: "6px" }}>
                        {catalogLoading ? (
                          <p style={{ color: "#a99bb2", textAlign: "center", padding: "12px" }}>
                            Loading {currentPlatform?.name} services…
                          </p>
                        ) : filteredCatalog.length === 0 ? (
                          <p style={{ color: "#a99bb2", textAlign: "center", padding: "12px" }}>
                            No {currentPlatform?.name} services found matching &quot;{catalogQuery}&quot;.
                          </p>
                        ) : (
                          filteredCatalog.slice(0, 40).map((row) => (
                            <button
                              key={row.provider_service_id}
                              type="button"
                              onClick={() => handleSelectProviderRow(row)}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "8px 12px",
                                borderRadius: "8px",
                                background: "#211130",
                                border: "1px solid #3b2354",
                                color: "#fff",
                                cursor: "pointer",
                                opacity: 1,
                                textAlign: "left",
                                gap: "10px",
                              }}
                            >
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                <strong style={{ color: "#d883ff" }}>#{row.provider_service_id}</strong> {row.name}
                              </span>
                              <small style={{ color: "#78dfb4", whiteSpace: "nowrap", fontWeight: 700 }}>
                                {formatProviderRate(row.provider_rate, row.provider_currency, row.rate_unit)}
                              </small>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {selectedProviderRow && (
                  <section className="create-service-economics" aria-label="Estimated service economics">
                    <header>
                      <div>
                        <p className="dashboard-kicker">ESTIMATED ECONOMICS</p>
                        <strong>{selectedProviderRow.name} · ReliableSMM #{selectedProviderRow.provider_service_id}</strong>
                        <span>Provider rate: {formatProviderRate(selectedProviderRow.provider_rate, selectedProviderRow.provider_currency, selectedProviderRow.rate_unit)}</span>
                      </div>
                      <span className={`create-eligibility ${selectedProviderRow.compatibility_state === "READY" ? "is-ready" : "is-review"}`}>
                        {selectedProviderRow.compatibility_state === "READY" ? "Metadata compatible · server validates full eligibility" : "Eligibility requires review"}
                      </span>
                    </header>
                    {selectedProviderRow.rate_unit !== "PER_1000" && selectedProviderRow.rate_unit !== "PER_ORDER" ? (
                      <p className="economics-unavailable">Economics unavailable: provider billing unit is unsupported. This provider cannot be mapped.</p>
                    ) : !fxRate ? (
                      <p className="economics-unavailable">Economics unavailable: {fxError ?? "USD → GHS FX is not configured."} A service can still be created without mapping under the existing workflow.</p>
                    ) : !creationEconomics ? (
                      <p className="economics-unavailable">Enter a valid customer price with at most three decimal places per 1,000 units to calculate estimates.</p>
                    ) : (
                      <>
                        <p className="create-fx-freshness">
                          FX: ₵{fxRate} per USD · {fxSource ?? "source unknown"} · {fxUpdatedAt ? `updated ${new Date(fxUpdatedAt).toLocaleString()}` : "freshness unknown"} · Provider catalog: {selectedProviderRow.last_synced_at ? new Date(selectedProviderRow.last_synced_at).toLocaleString() : "timestamp unknown"}
                        </p>
                        {([
                          ["1,000 units", creationEconomics.per1000],
                          ["10,000 units", creationEconomics.per10000],
                        ] as const).map(([quantityLabel, result]) => (
                          <div className="create-economics-line" key={quantityLabel}>
                            <strong>{quantityLabel}</strong>
                            <span>
                              Revenue ₵{formatGhsAmount(result.revenueGhs)} · Provider cost ₵{formatGhsAmount(result.providerCostGhs)}
                              {selectedProviderRow.rate_unit === "PER_ORDER" ? " / order (charged once)" : ""}
                              {" · "}Profit <b className={`profit-${result.profitability.toLowerCase()}`}>₵{formatGhsAmount(result.grossProfitGhs)}</b>
                              {" · "}Margin {result.grossMarginPercent ?? "Unavailable"}%
                            </span>
                          </div>
                        ))}
                        <small>
                          Markup at 1,000 units: {creationEconomics.per1000.markupPercent == null ? "Unavailable (zero provider cost)" : `${creationEconomics.per1000.markupPercent}%`}. Estimates only; provider cost and FX may change.
                        </small>
                      </>
                    )}
                  </section>
                )}

                {/* Form Fields Grid */}
                <div className="create-service-field-stack">
                  <label className="create-service-field create-service-field-wide">
                    <span>Service Name *</span>
                    <input
                      required
                      placeholder="e.g. Followers, Likes, Views"
                      value={serviceName}
                      onChange={(e) => setServiceName(e.target.value)}
                    />
                  </label>

                  <div className="create-service-grid create-service-grid-two">
                    <label className="create-service-field">
                      <span>Category</span>
                      <input
                        required
                        placeholder="e.g. Followers, Likes"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                      />
                    </label>
                    <label className="create-service-field">
                      <span>Target Type *</span>
                      <select
                        value={targetType}
                        onChange={(e) => setTargetType(e.target.value)}
                        required
                      >
                        {TARGET_OPTIONS.map(([val, label]) => (
                          <option key={val} value={val}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="create-service-grid create-service-grid-three">
                    <label className="create-service-field">
                      <span>Min Quantity *</span>
                      <input
                        type="number"
                        min="1"
                        required
                        value={minQty}
                        onChange={(e) => setMinQty(e.target.value)}
                      />
                    </label>
                    <label className="create-service-field">
                      <span>Max Quantity *</span>
                      <input
                        type="number"
                        min="1"
                        required
                        value={maxQty}
                        onChange={(e) => setMaxQty(e.target.value)}
                      />
                    </label>
                    <label className="create-service-field">
                      <span>Customer Price (GHS per 1,000 units) *</span>
                      <input
                        required
                        placeholder="e.g. 5.00"
                        value={sellingRate}
                        onChange={(e) => setSellingRate(e.target.value)}
                      />
                      <small className="create-service-helper">
                        Enter the total customer price for 1,000 units.
                      </small>
                    </label>
                  </div>

                  <label className="create-service-field create-service-field-wide">
                    <span>Describe your service (optional)</span>
                    <textarea
                      placeholder="Describe what customers receive and include any useful instructions."
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={2}
                    />
                  </label>
                </div>

                <div className="mapping-modal-actions create-service-actions">
                  <button
                    type="button"
                    className="mapping-cancel"
                    onClick={() => setMode("platform_select")}
                    disabled={busy}
                  >
                    ← Back
                  </button>
                  <button type="submit" className="mapping-confirm" disabled={busy}>
                    {busy ? "Creating…" : `Add Service to ${currentPlatform?.name ?? "Platform"}`}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>,
        document.body
      )}
    </>
  );
}

function formatProviderRate(rate: string | number, currency: string, unit: string): string {
  if (unit === "PER_1000") return `${currency === "USD" ? "$" : `${currency} `}${rate} / 1,000`;
  if (unit === "PER_ORDER") return `${currency === "USD" ? "$" : `${currency} `}${rate} / order`;
  return `Rate ${rate} ${currency} · unsupported unit (${unit || "unknown"})`;
}
