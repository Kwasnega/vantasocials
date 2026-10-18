"use client";

import Link from "next/link";
import { useState } from "react";
import type { CatalogPlatform } from "../../lib/catalog/platforms";
import type { CatalogService } from "../../lib/catalog/services";
import { getPlatformLogoUrl } from "../../lib/catalog/logo";
import { unitRateToAdminPricePer1000 } from "../../lib/pricing/customer-price";

function formatCatalogPrice(unitRate: string) {
  const [whole, fraction = ""] = unitRateToAdminPricePer1000(unitRate).split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

function PlatformLogo({ platform }: { platform: CatalogPlatform }) {
  const [failed, setFailed] = useState(false);
  const logoUrl = getPlatformLogoUrl(platform.slug);

  return (
    <span className="platform-logo">
      {logoUrl && !failed ? (
        <img
          src={logoUrl}
          alt={`${platform.name} logo`}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-label={`${platform.name} logo`}>{platform.logo || platform.name.slice(0, 1)}</span>
      )}
    </span>
  );
}

export default function PlatformCatalog({ platforms, services }: { platforms: CatalogPlatform[]; services: CatalogService[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const catalog = platforms
    .map((platform) => ({
      platform,
      services: services.filter((service) => service.platform_id === platform.id && service.active),
    }))
    .filter((item) => item.services.length > 0);

  if (catalog.length === 0) {
    return (
      <div className="catalog-empty" role="status">
        <strong>No services are available right now.</strong>
        <span>Please check back soon.</span>
      </div>
    );
  }

  return (
    <div className="order-catalog">
      {catalog.map(({ platform, services: platformServices }) => {
        const expanded = open === platform.id;
        const servicesId = `catalog-services-${platform.id}`;

        return (
          <section className={`dashboard-card catalog-card${expanded ? " is-open" : ""}`} key={platform.id}>
            <button
              className="catalog-card-trigger"
              type="button"
              onClick={() => setOpen(expanded ? null : platform.id)}
              aria-expanded={expanded}
              aria-controls={servicesId}
            >
              <PlatformLogo platform={platform} />
              <span className="catalog-card-heading">
                <span className="catalog-eyebrow">PLATFORM</span>
                <strong>{platform.name}</strong>
              </span>
              <span className="catalog-count">
                <span>{platformServices.length} services</span>
                <b className="catalog-chevron" aria-hidden="true">⌄</b>
              </span>
            </button>
            <p>{platform.description}</p>
            <div className="catalog-services" id={servicesId} hidden={!expanded}>
              {platformServices.map((service) => (
                <div className="catalog-service" key={service.id}>
                  <span>
                    <b>{service.name}</b>
                    <small className="catalog-service-price">
                      {service.currency} {formatCatalogPrice(service.selling_rate)} per 1,000
                    </small>
                    <span className="catalog-service-range">
                      Range: {service.min_quantity.toLocaleString()}–{service.max_quantity.toLocaleString()}
                    </span>
                  </span>
                  <Link href={`/services/${service.slug}`}>Choose <b aria-hidden="true">→</b></Link>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
