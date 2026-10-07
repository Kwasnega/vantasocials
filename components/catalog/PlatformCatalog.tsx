"use client";

import Link from "next/link";
import { useState } from "react";
import type { CatalogPlatform } from "../../lib/catalog/platforms";
import type { CatalogService } from "../../lib/catalog/services";
import { getPlatformLogoUrl } from "../../lib/catalog/logo";

export default function PlatformCatalog({ platforms, services }: { platforms: CatalogPlatform[]; services: CatalogService[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return <div className="order-catalog">{platforms.map((platform) => {
    const platformServices = services.filter((service) => service.platform_id === platform.id && service.active);
    const expanded = open === platform.id;
    return <section className={`dashboard-card catalog-card${expanded ? " is-open" : ""}`} key={platform.id} onMouseEnter={() => setOpen(platform.id)} onMouseLeave={() => setOpen(null)}>
      <button className="catalog-card-trigger" type="button" onClick={() => setOpen(expanded ? null : platform.id)} aria-expanded={expanded}>
        <span className="platform-logo">
          {getPlatformLogoUrl(platform.slug) ? (
            <img src={getPlatformLogoUrl(platform.slug)!} alt={`${platform.name} logo`} loading="lazy" />
          ) : (
            platform.logo || platform.name.slice(0, 1)
          )}
        </span>
        <span className="catalog-card-heading"><span className="catalog-eyebrow">PLATFORM</span><strong>{platform.name}</strong></span>
        <span className="catalog-count">{platformServices.length} services <b className="catalog-chevron">⌄</b></span>
      </button>
      <p>{platform.description}</p>
      <div className="catalog-services">{platformServices.map((service) => <div className="catalog-service" key={service.id}><span><b>{service.name}</b><small>{service.min_quantity.toLocaleString()}–{service.max_quantity.toLocaleString()}</small></span><Link href={`/services/${service.slug}`}>Start order <b>↗</b></Link></div>)}</div>
    </section>;
  })}</div>;
}
