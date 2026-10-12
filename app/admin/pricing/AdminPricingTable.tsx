"use client";

import { useMemo, useState } from "react";
import { unitRateToAdminPricePer1000 } from "../../../lib/pricing/customer-price";

type PricingService = {
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
  platform: { id: string; name: string; slug: string } | null;
};

export function AdminPricingTable({
  services,
  fxRate,
}: {
  services: PricingService[];
  fxRate: string | null;
}) {
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("all");
  const [mapping, setMapping] = useState("all");
  const [rateUnit, setRateUnit] = useState("all");
  const [availability, setAvailability] = useState("all");

  const platforms = useMemo(
    () => [...new Map(services.filter((service) => service.platform).map((service) => [service.platform!.id, service.platform!])).values()]
      .sort((left, right) => left.name.localeCompare(right.name)),
    [services],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return services.filter((service) => {
      const matchesSearch = !query || [
        service.name,
        service.slug,
        service.platform?.name ?? "",
        service.provider ?? "",
        service.provider_service_id ?? "",
      ].some((value) => value.toLowerCase().includes(query));
      const matchesPlatform = platform === "all" || service.platform?.id === platform;
      const matchesMapping = mapping === "all"
        || (mapping === "mapped" ? Boolean(service.provider && service.provider_service_id) : !(service.provider && service.provider_service_id));
      const matchesUnit = rateUnit === "all"
        || (rateUnit === "UNKNOWN"
          ? !["PER_1000", "PER_ORDER", "PER_UNIT"].includes(service.provider_rate_unit ?? "")
          : service.provider_rate_unit === rateUnit);
      const matchesAvailability = availability === "all"
        || (availability === "active" ? service.active : !service.active);
      return matchesSearch && matchesPlatform && matchesMapping && matchesUnit && matchesAvailability;
    });
  }, [services, search, platform, mapping, rateUnit, availability]);

  return (
    <>
      <section className="pricing-stats" aria-label="Pricing overview">
        <article><span>Total services</span><strong>{services.length}</strong></article>
        <article><span>Mapped services</span><strong>{services.filter((service) => service.provider && service.provider_service_id).length}</strong></article>
        <article><span>Unmapped services</span><strong>{services.filter((service) => !(service.provider && service.provider_service_id)).length}</strong></article>
        <article className="pricing-fx-card">
          <span>USD → GHS estimate rate</span>
          <strong>{fxRate ? `₵${fxRate}` : "Not configured"}</strong>
          <small>Used for internal provider-cost estimates only</small>
        </article>
      </section>

      <section className="pricing-panel" aria-label="Service prices">
        <header className="pricing-panel-heading">
          <div>
            <p className="dashboard-kicker">SERVICE PRICE BOOK</p>
            <h2>Customer and provider rates</h2>
            <p>Customer prices are shown per 1,000 units. Provider rates use their listed billing basis.</p>
          </div>
          <span className="pricing-result-count">{filtered.length} of {services.length} services</span>
        </header>

        <div className="pricing-filters">
          <label className="pricing-search">
            <span>Search services</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, slug, platform, provider…"
            />
          </label>
          <label>
            <span>Platform</span>
            <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
              <option value="all">All platforms</option>
              {platforms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>
            <span>Provider mapping</span>
            <select value={mapping} onChange={(event) => setMapping(event.target.value)}>
              <option value="all">All services</option>
              <option value="mapped">Mapped</option>
              <option value="unmapped">Unmapped</option>
            </select>
          </label>
          <label>
            <span>Provider billing unit</span>
            <select value={rateUnit} onChange={(event) => setRateUnit(event.target.value)}>
              <option value="all">All billing units</option>
              <option value="PER_1000">PER_1000</option>
              <option value="PER_ORDER">PER_ORDER</option>
              <option value="PER_UNIT">PER_UNIT</option>
              <option value="UNKNOWN">Unknown / unsupported</option>
            </select>
          </label>
          <label>
            <span>Service status</span>
            <select value={availability} onChange={(event) => setAvailability(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>

        {filtered.length ? (
          <div className="dashboard-table-wrap pricing-table-wrap">
            <table className="dashboard-table pricing-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Platform</th>
                  <th>Customer price / 1,000</th>
                  <th>Provider mapping</th>
                  <th>Provider rate</th>
                  <th>Billing unit</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((service) => (
                  <tr key={service.id}>
                    <td><strong>{service.name}</strong><small>{service.slug}{service.active ? "" : " · Inactive"}</small></td>
                    <td>{service.platform?.name ?? "—"}</td>
                    <td><strong className="pricing-customer-price">{formatAdminPrice(service.selling_rate)} {service.currency}</strong></td>
                    <td>
                      {service.provider && service.provider_service_id
                        ? <span className="pricing-mapping-badge is-mapped">{service.provider} · {service.provider_service_id}</span>
                        : <span className="pricing-mapping-badge">Unmapped</span>}
                    </td>
                    <td>{service.provider_rate == null ? "—" : `${service.provider_rate} ${service.provider_currency ?? ""}`}</td>
                    <td>{service.provider_rate_unit ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="pricing-no-results">
            <strong>No matching services</strong>
            <span>Change or clear the search and filters to see more pricing records.</span>
          </div>
        )}
      </section>
    </>
  );
}

function formatAdminPrice(rate: string | number): string {
  try {
    return unitRateToAdminPricePer1000(rate);
  } catch {
    return "Unavailable";
  }
}
