import Link from "next/link";
import { requireAdmin } from "../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../lib/supabase/server";
import { MappingControl } from "./MappingControl";
import { PricingControl } from "./PricingControl";
import { CreateServiceCard, type AdminPlatform } from "./CreateServiceCard";
import { DeleteServiceButton } from "./DeleteServiceButton";
import { getPlatformLogoUrl } from "../../../lib/catalog/logo";

type Service = {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  selling_rate: number;
  currency: string;
  provider: string | null;
  provider_service_id: string | null;
  provider_rate: number | null;
  provider_rate_unit: string | null;
  provider_currency: string | null;
  provider_rate_last_synced: string | null;
  platform_id: string;
  platforms: { id?: string; name?: string; slug?: string } | null;
};

function ServiceTable({
  services,
  fxRate,
  showPlatform = false,
}: {
  services: Service[];
  fxRate: string | null;
  showPlatform?: boolean;
}) {
  return (
    <div className="dashboard-table-wrap">
      <table className="dashboard-table services-table">
        <thead>
          <tr>
            {showPlatform && <th>Platform</th>}
            <th>Service</th>
            <th>Customer price</th>
            <th>Published</th>
            <th>Provider mapping</th>
            <th>Last sync</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {services.map((service) => (
            <tr key={service.id}>
              {showPlatform && <td>{service.platforms?.name ?? "Unknown platform"}</td>}
              <td>
                <strong>{service.name}</strong>
                <small>{service.slug}</small>
              </td>
              <td>
                {service.selling_rate} {service.currency}
              </td>
              <td>
                <span className={`service-status ${service.active ? "is-active" : ""}`}>
                  <i />
                  {service.active ? "Published" : "Hidden"}
                </span>
              </td>
              <td>
                {service.provider ? (
                  <span className="mapping-copy">
                    {service.provider} / {service.provider_service_id}
                    <small>
                      {service.provider_rate} {service.provider_currency} /{" "}
                      {service.provider_rate_unit}
                    </small>
                  </span>
                ) : (
                  <span className="mapping-unmapped">UNMAPPED</span>
                )}
              </td>
              <td>
                {service.provider_rate_last_synced
                  ? new Date(service.provider_rate_last_synced).toLocaleDateString()
                  : "—"}
              </td>
              <td>
                <Link href={`/admin/services/${service.id}/inputs`}>Configure Inputs</Link>
                <MappingControl
                  serviceId={service.id}
                  serviceSlug={service.slug}
                  serviceName={service.name}
                  current={service.provider_service_id}
                  fxRate={fxRate}
                />
                <DeleteServiceButton serviceId={service.id} serviceName={service.name} />
                {service.provider && (
                  <PricingControl
                    serviceId={service.id}
                    sellingRate={String(service.selling_rate)}
                    providerRate={
                      service.provider_rate == null ? null : String(service.provider_rate)
                    }
                    providerRateUnit={service.provider_rate_unit}
                    providerCurrency={service.provider_currency}
                    fxRate={fxRate}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminServicesPage() {
  const { admin } = await requireAdmin();
  if (!admin) return null;

  const db = createSupabaseAdminClient();
  const [{ data: servicesData }, { data: setting }, { data: platformsData }] = await Promise.all([
    db
      .from("services")
      .select(
        "id,slug,name,active,selling_rate,currency,provider,provider_service_id,provider_rate,provider_rate_unit,provider_currency,provider_rate_last_synced,platform_id,platforms(id,name,slug)"
      )
      .order("slug"),
    db.from("pricing_settings").select("fx_rate").eq("key", "USD_GHS").maybeSingle(),
    db.from("platforms").select("id,name,slug,logo,color,description").eq("active", true).order("name"),
  ]);

  const services = (servicesData ?? []) as Service[];
  const publishedServices = services.filter((service) => service.active);
  const hiddenServices = services.filter((service) => !service.active);
  const platforms = (platformsData ?? []) as AdminPlatform[];
  const livePlatforms = platforms.filter((platform) =>
    publishedServices.some((service) => service.platform_id === platform.id)
  );
  const fxRate = setting?.fx_rate ? String(setting.fx_rate) : null;

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
      <div className="dashboard-card create-service-card" style={{ marginBottom: "20px" }}>
        <div>
          <p className="dashboard-kicker">VANTA CATALOG</p>
          <h2>Add Services by Platform</h2>
          <p>
            Select a social media platform to add new growth services under its card.
          </p>
        </div>
        <CreateServiceCard platforms={platformsWithCounts} />
      </div>

      {/* Summary KPI Strip */}
      <section className="services-summary">
        <article>
          <span>Platforms</span>
          <strong>{platforms.length}</strong>
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
      </section>

      {/* Published services only; this mirrors the customer-visible catalog. */}
      <div className="service-category-list">
        {livePlatforms.map((platform, index) => {
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
                  />
                  <span className="service-category-chevron" aria-hidden="true">
                    ⌄
                  </span>
                </div>
              </summary>

              <div className="dashboard-card service-category-card">
                <ServiceTable services={platformServices} fxRate={fxRate} />
              </div>
            </details>
          );
        })}
        {livePlatforms.length === 0 && (
          <p className="dashboard-card" style={{ padding: "24px", color: "#a99bb2" }}>
            No services are currently published on the homepage.
          </p>
        )}
      </div>

      {hiddenServices.length > 0 && (
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
            <ServiceTable services={hiddenServices} fxRate={fxRate} showPlatform />
          </div>
        </details>
      )}
    </div>
  );
}
