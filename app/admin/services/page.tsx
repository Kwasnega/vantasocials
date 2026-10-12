import Link from "next/link";
import { requireAdmin } from "../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../lib/supabase/server";
import { MappingControl } from "./MappingControl";
import { CreateServiceCard, type AdminPlatform } from "./CreateServiceCard";
import { DeleteServiceButton } from "./DeleteServiceButton";
import { getPlatformLogoUrl } from "../../../lib/catalog/logo";
import { AdminEmptyState, AdminQueryError } from "../AdminDataState";
import { unitRateToAdminPricePer1000 } from "../../../lib/pricing/customer-price";
import { derivePricing } from "../../../lib/admin/pricing";
import { PriceOnlyControl } from "./PriceOnlyControl";
import { assessProviderEligibility } from "../../../lib/targets/eligibility";
import { getTargetContractForService } from "../../../lib/targets/contracts";
import {
  matchesApprovedProviderOperation,
  resolveProviderCompatibility,
  resolveProviderPlatformCompatibility,
} from "../../../lib/admin/provider-compatibility";
import { formatGhsAmount, normalizePricingValue, normalizeProviderPricingValue } from "../../../lib/pricing/engine";

type Service = {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  selling_rate: string | number;
  currency: string;
  provider: string | null;
  provider_service_id: string | null;
  provider_rate: string | number | null;
  provider_rate_unit: string | null;
  provider_currency: string | null;
  provider_rate_last_synced: string | null;
  platform_id: string;
  min_quantity: number;
  max_quantity: number;
  target_type: string;
  platforms: { id?: string; name?: string; slug?: string } | null;
  catalog_status: string | null;
  catalog_updated_at: string | null;
  economics_rate: string | number | null;
  economics_unit: string | null;
  economics_currency: string | null;
  economics_source: string;
  eligibility: string;
};

function ServiceTable({
  services,
  fxRate,
  fxError,
  fxUpdatedAt,
  fxSource,
  showPlatform = false,
}: {
  services: Service[];
  fxRate: string | null;
  fxError: string | null;
  fxUpdatedAt: string | null;
  fxSource: string | null;
  showPlatform?: boolean;
}) {
  return (
    <div className="admin-economics-list">
      {services.map((service) => {
        const fxValid = isValidFxRate(fxRate);
        const pricing = fxValid && fxRate ? derivePricing({
          id: service.id,
          slug: service.slug,
          name: service.name,
          selling_rate: service.selling_rate,
          currency: service.currency,
          provider: service.provider,
          provider_service_id: service.provider_service_id,
          provider_rate: service.economics_rate,
          provider_rate_unit: service.economics_unit,
          provider_currency: service.economics_currency,
          provider_rate_last_synced: service.catalog_updated_at,
          min_quantity: service.min_quantity,
          max_quantity: service.max_quantity,
          active: service.active,
        }, fxRate) : null;
        const per1000 = pricing?.status === "AVAILABLE" ? pricing.per1000 : null;
        const mapped = Boolean(service.provider && service.provider_service_id);
        const updatedAt = service.catalog_updated_at
          ? new Date(service.catalog_updated_at).toLocaleString()
          : "Unknown";
        return (
          <article className="admin-economics-card" key={service.id}>
            <header className="admin-economics-card-header">
              <div>
                {showPlatform && <p className="admin-economics-platform">{service.platforms?.name ?? "Unknown platform"}</p>}
                <h3>{service.name}</h3>
                <span>{service.slug}</span>
              </div>
              <div className="admin-economics-badges">
                <span className={service.active ? "is-active" : "is-muted"}>{service.active ? "Published" : "Hidden"}</span>
                <span className={mapped ? "is-mapped" : "is-muted"}>{mapped ? "Mapped" : "Unmapped"}</span>
              </div>
            </header>

            <div className="admin-economics-grid">
              <div><small>Provider</small><strong>{mapped ? service.provider : "Not mapped"}</strong><span>{service.provider_service_id ? `Service #${service.provider_service_id}` : "—"}</span></div>
              <div><small>Provider original rate</small><strong>{service.economics_rate == null ? "Unavailable" : `${service.economics_currency === "USD" ? "$" : ""}${service.economics_rate} ${service.economics_currency ?? ""}`}</strong><span>{service.economics_unit === "PER_1000" ? "per 1,000 provider units" : service.economics_unit === "PER_ORDER" ? "per order" : service.economics_unit === "PER_UNIT" ? "per unit" : "unsupported or unknown basis"}</span></div>
              <div><small>Customer selling price</small><strong>{formatSellingPrice(service.selling_rate)} {service.currency}</strong><span>per 1,000 customer units</span></div>
              <div><small>USD → GHS estimate rate</small><strong>{fxValid && fxRate ? `₵${fxRate} / USD` : "Unavailable"}</strong><span>{!fxRate ? fxError ?? "FX not configured" : !fxValid ? fxError ?? "Configured FX value is invalid or outside supported precision" : `${fxSource ?? "Source unknown"} · ${fxUpdatedAt ? new Date(fxUpdatedAt).toLocaleString() : "freshness unknown"}`}</span></div>
            </div>

            <div className="admin-economics-summary">
              {per1000 ? (
                <>
                  <div><small>Estimated provider cost · 1,000 units</small><strong>₵{formatGhsAmount(per1000.providerCostGhs)}</strong>{service.economics_unit === "PER_ORDER" && <span>Provider charges once per order</span>}</div>
                  <div><small>Estimated gross profit · 1,000 units</small><strong className={`profit-${per1000.profitability.toLowerCase()}`}>₵{formatGhsAmount(per1000.grossProfitGhs)}</strong><span>Estimated gross margin: {per1000.grossMarginPercent ?? "Unavailable"}% · Markup: {per1000.markupPercent == null ? "Unavailable (zero provider cost)" : `${per1000.markupPercent}%`}</span></div>
                </>
              ) : (
                <div className="economics-unavailable">
                  <strong>Provider economics unavailable</strong>
                  <span>{!fxRate ? fxError ?? "Configure a valid USD → GHS exchange rate." : !fxValid ? fxError ?? "The configured FX value is invalid or outside supported precision." : pricing?.status === "UNAVAILABLE" ? pricing.reason : "Service has no provider mapping or rate."}</span>
                </div>
              )}
            </div>

            <footer className="admin-economics-footer">
              <span>Mapping: {mapped ? `${service.provider} · ${service.catalog_status ?? "catalog status unknown"}` : "not configured"} · Eligibility: {service.eligibility}</span>
              <span>Provider-rate source: {service.economics_source} · Timestamp: {updatedAt}{!service.catalog_updated_at ? " (unknown; mapping time is not treated as provider sync time)" : ""}</span>
              <span>Estimates only; actual provider charges and FX may differ.</span>
            </footer>
            <div className="admin-economics-actions">
              <Link href={`/admin/services/${service.id}/inputs`}>Configure Inputs</Link>
              <PriceOnlyControl
                slug={service.slug}
                serviceName={service.name}
                providerRate={service.economics_rate}
                providerRateUnit={service.economics_unit}
                providerCurrency={service.economics_currency}
                fxRate={fxRate}
              />
              <MappingControl serviceId={service.id} serviceSlug={service.slug} serviceName={service.name} current={service.provider_service_id} />
              <DeleteServiceButton serviceId={service.id} serviceName={service.name} />
            </div>
          </article>
        );
      })}
    </div>
  );
}

export default async function AdminServicesPage() {
  const { admin } = await requireAdmin();
  if (!admin) return null;

  const db = createSupabaseAdminClient();
  const [
    { data: servicesData, error: servicesError },
    { data: setting, error: settingError },
    { data: platformsData, error: platformsError },
  ] = await Promise.all([
    db
      .from("services")
      .select(
        "id,slug,name,active,selling_rate,currency,provider,provider_service_id,provider_rate,provider_rate_unit,provider_currency,provider_rate_last_synced,platform_id,min_quantity,max_quantity,target_type,platforms(id,name,slug)"
      )
      .order("slug"),
    db.from("pricing_settings").select("fx_rate,fx_source,updated_at").eq("key", "USD_GHS").maybeSingle(),
    db.from("platforms").select("id,name,slug,logo,color,description").eq("active", true).order("name"),
  ]);

  const rawServices = (servicesData ?? []) as Omit<Service, "catalog_status" | "catalog_updated_at" | "economics_rate" | "economics_unit" | "economics_currency" | "economics_source" | "eligibility">[];
  const mappedIds = [...new Set(rawServices.filter((service) => service.provider === "reliablesmm" && service.provider_service_id).map((service) => service.provider_service_id!))];
  let catalogById = new Map<string, {
    provider_service_id: string; name: string; provider_rate: string | number; provider_currency: string;
    rate_unit: string; provider_status: string; last_synced_at: string | null; min_quantity: number;
    max_quantity: number; raw_metadata: unknown;
  }>();
  let catalogError = false;
  if (mappedIds.length) {
    const { data, error } = await db.from("provider_catalog_services")
      .select("provider_service_id,name,provider_rate,provider_currency,rate_unit,provider_status,last_synced_at,min_quantity,max_quantity,raw_metadata")
      .eq("provider", "reliablesmm")
      .in("provider_service_id", mappedIds);
    catalogError = Boolean(error);
    if (data) catalogById = new Map(data.map((row) => [String(row.provider_service_id), row]));
  }
  const services = rawServices.map((service): Service => {
    const catalog = service.provider_service_id ? catalogById.get(service.provider_service_id) : undefined;
    const economicsRate = catalog?.provider_rate ?? service.provider_rate;
    const economicsUnit = catalog?.rate_unit ?? service.provider_rate_unit;
    const economicsCurrency = catalog?.provider_currency ?? service.provider_currency;
    let eligibility = !service.provider ? "NOT MAPPED" : catalogError ? "UNKNOWN · catalog lookup failed" : "UNKNOWN · catalog row unavailable";
    if (catalog) {
      const compatibility = resolveProviderCompatibility(catalog.raw_metadata, catalog.name);
      const platform = service.platforms as { slug?: string; name?: string } | null;
      const platformCompatibility = resolveProviderPlatformCompatibility(catalog.raw_metadata, platform, catalog.name);
      const metadata = catalog.raw_metadata && typeof catalog.raw_metadata === "object" ? catalog.raw_metadata as { category?: unknown } : null;
      const assessed = assessProviderEligibility({
        serviceSlug: service.slug,
        targetContract: getTargetContractForService({ slug: service.slug, targetType: service.target_type, platformSlug: platform?.slug }),
        operationCompatibilityVerified: matchesApprovedProviderOperation(service.slug, service.provider_service_id ?? "", catalog.name, String(metadata?.category ?? "")),
        expectedTargetType: service.target_type,
        providerTargetType: compatibility.compatibility?.targetType,
        platformCompatibilityState: platformCompatibility.state,
        vantaMin: service.min_quantity,
        vantaMax: service.max_quantity,
        provider: {
          provider: "reliablesmm",
          provider_service_id: String(catalog.provider_service_id),
          name: catalog.name,
          provider_status: catalog.provider_status,
          provider_rate: catalog.provider_rate,
          provider_currency: catalog.provider_currency,
          rate_unit: catalog.rate_unit,
          min_quantity: catalog.min_quantity,
          max_quantity: catalog.max_quantity,
          raw_metadata: catalog.raw_metadata,
        },
      });
      eligibility = `${assessed.status} · ${assessed.reason}`;
    }
    return {
      ...service,
      catalog_status: catalog?.provider_status ?? null,
      catalog_updated_at: catalog?.last_synced_at ?? null,
      economics_rate: economicsRate,
      economics_unit: economicsUnit,
      economics_currency: economicsCurrency,
      economics_source: catalog ? "provider catalog" : "stored mapping snapshot",
      eligibility,
    };
  });
  const publishedServices = services.filter((service) => service.active);
  const hiddenServices = services.filter((service) => !service.active);
  const platforms = (platformsData ?? []) as AdminPlatform[];
  const livePlatforms = platforms.filter((platform) =>
    publishedServices.some((service) => service.platform_id === platform.id)
  );
  let fxRate: string | null = null;
  let fxError: string | null = null;
  if (!settingError && setting?.fx_rate != null) {
    try {
      fxRate = normalizePricingValue(setting.fx_rate, false);
    } catch (error) {
      fxError = error instanceof Error ? error.message : "Configured USD → GHS rate is invalid.";
    }
  }
  const fxUpdatedAt = settingError ? null : setting?.updated_at ?? null;
  const fxSource = settingError ? null : setting?.fx_source ?? null;

  const platformsWithCounts: AdminPlatform[] = platforms.map((p) => ({
    ...p,
    servicesCount: services.filter((s) => s.platform_id === p.id).length,
  }));

  return (
    <div className="services-redesign">
      <header className="services-hero">
        <div>
          <p className="dashboard-kicker">ADMIN / CATALOG</p>
          <h1>
            Services<span>.</span>
          </h1>
          <p>
            Manage the live homepage catalog. Hidden and unpublished services are kept separate
            until they are ready to publish.
          </p>
        </div>
        <div className="services-hero-mark" aria-hidden="true">
          V
        </div>
      </header>

      {/* Top Action Card */}
      {platformsError ? <AdminQueryError message="Platforms could not be loaded. Service creation is unavailable until this is resolved." /> : <div className="dashboard-card create-service-card" style={{ marginBottom: "20px" }}>
        <div>
          <p className="dashboard-kicker">VANTA CATALOG</p>
          <h2>Add Services by Platform</h2>
          <p>
            Select a social media platform to add new growth services under its card.
          </p>
        </div>
        <CreateServiceCard platforms={platformsWithCounts} fxRate={fxRate} fxError={fxError} fxUpdatedAt={fxUpdatedAt} fxSource={fxSource} />
      </div>}
      {servicesError && <AdminQueryError message="Service records could not be loaded. Catalog counts and lists are unavailable." />}
      {platformsError && <AdminQueryError message="Active platforms could not be loaded." />}
      {settingError && <AdminQueryError message="Pricing settings could not be loaded. Pricing previews may be unavailable." />}
      {catalogError && <AdminQueryError message="Current provider catalog rows could not be loaded. Stored mapping rates are shown only as snapshots; provider cost freshness is unknown." />}

      {/* Summary KPI Strip */}
      {!servicesError && <section className="services-summary">
        <article>
          <span>Platforms</span>
          {platformsError ? <AdminQueryError message="Unavailable" /> : <strong>{platforms.length}</strong>}
          <small>Active social platforms</small>
        </article>
        <article>
          <span>Total services</span>
          <strong>{services.length}</strong>
          <small>Available catalog records</small>
        </article>
        <article>
          <span>Published</span>
          <strong>{services.filter((s) => s.active).length}</strong>
          <small>Customer-visible services</small>
        </article>
        <article>
          <span>Unmapped</span>
          <strong>{services.filter((s) => !s.provider).length}</strong>
          <small>Need provider mapping</small>
        </article>
      </section>}

      {/* Published services only; this mirrors the customer-visible catalog. */}
      {!servicesError && <div className="service-category-list">
        {platformsError ? <AdminQueryError message="Published service groups could not be loaded because platform data is unavailable." /> : null}
        {!platformsError && livePlatforms.map((platform, index) => {
          const platformServices = publishedServices.filter((s) => s.platform_id === platform.id);
          const logoUrl = getPlatformLogoUrl(platform.slug);

          return (
            <details
              className="service-category"
              key={platform.id}
              name="service-category"
              open={index === 0}
            >
              <summary className="service-category-heading">
                <span className="service-category-platform">
                  <span className="service-category-logo">
                    {logoUrl ? <img src={logoUrl} alt="" /> : platform.logo || platform.name.slice(0, 2)}
                  </span>
                  <h2>{platform.name}</h2>
                  <span
                    style={{
                      padding: "4px 10px",
                      borderRadius: "999px",
                      background: "#2a153c",
                      border: "1px solid #482968",
                      color: "#d8c8e0",
                      fontSize: "12px",
                      fontWeight: 800,
                    }}
                  >
                    {platformServices.length}{" "}
                    {platformServices.length === 1 ? "service" : "services"}
                  </span>
                </span>

                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <CreateServiceCard
                    platforms={platformsWithCounts}
                    defaultPlatformId={platform.id}
                    triggerLabel={`+ Add ${platform.name} Service`}
                    triggerClassName="mapping-confirm"
                    fxRate={fxRate}
                    fxError={fxError}
                    fxUpdatedAt={fxUpdatedAt}
                    fxSource={fxSource}
                  />
                  <span className="service-category-chevron" aria-hidden="true">
                    ⌄
                  </span>
                </div>
              </summary>

              <div className="dashboard-card service-category-card">
                <ServiceTable services={platformServices} fxRate={fxRate} fxError={fxError} fxUpdatedAt={fxUpdatedAt} fxSource={fxSource} />
              </div>
            </details>
          );
        })}
        {!platformsError && livePlatforms.length === 0 && <AdminEmptyState message="No services are currently published on the homepage." />}
      </div>}

      {!servicesError && hiddenServices.length > 0 && (
        <details className="service-category" style={{ marginTop: "24px" }}>
          <summary className="service-category-heading">
            <span className="service-category-platform">
              <h2>Hidden / unpublished services</h2>
              <span
                style={{
                  padding: "4px 10px",
                  borderRadius: "999px",
                  background: "#2a153c",
                  border: "1px solid #482968",
                  color: "#d8c8e0",
                  fontSize: "12px",
                  fontWeight: 800,
                }}
              >
                {hiddenServices.length}
              </span>
            </span>
            <span className="service-category-chevron" aria-hidden="true">
              ⌄
            </span>
          </summary>
          <div className="dashboard-card service-category-card">
            <p style={{ margin: "0 0 16px", color: "#a99bb2" }}>
              These services are not visible on the homepage. Manage them here without affecting
              the live catalog.
            </p>
            <ServiceTable services={hiddenServices} fxRate={fxRate} fxError={fxError} fxUpdatedAt={fxUpdatedAt} fxSource={fxSource} showPlatform />
          </div>
        </details>
      )}
    </div>
  );
}

function isValidFxRate(value: string | null): boolean {
  if (!value) return false;
  try {
    normalizeProviderPricingValue(value, false);
    return true;
  } catch {
    return false;
  }
}

function formatSellingPrice(rate: string | number): string {
  try {
    return `₵${formatGhsAmount(unitRateToAdminPricePer1000(rate))}`;
  } catch {
    return "Customer price unavailable";
  }
}
