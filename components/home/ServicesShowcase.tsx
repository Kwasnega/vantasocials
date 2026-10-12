"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  groupHomepageServices,
  type HomepageCatalogResponse,
  type HomepageShowcaseService,
} from "../../lib/catalog/homepage-contract";
import { getPlatformLogoUrl } from "../../lib/catalog/logo";

type ShowcasePlatform = { id: string; name: string; logo: string };
type ShowcaseCatalogPlatform = ShowcasePlatform & { slug: string };

const ArrowUpRight = () => <span aria-hidden="true" className="arrow">&#8599;</span>;

export function ServicesShowcase() {
  const [platforms, setPlatforms] = useState<ShowcaseCatalogPlatform[]>([]);
  const [servicesByPlatform, setServicesByPlatform] = useState<Map<string, HomepageShowcaseService[]>>(() => new Map());
  const [platform, setPlatform] = useState<ShowcaseCatalogPlatform | null>(null);
  const [service, setService] = useState("");
  const [catalogStatus, setCatalogStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const initialLoadStarted = useRef(false);
  const requestInFlight = useRef(false);
  const selectedPlatformId = useRef<string | null>(null);
  const services = platform ? servicesByPlatform.get(platform.id) ?? [] : [];

  const loadCatalog = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setPlatforms([]);
    setServicesByPlatform(new Map());
    setPlatform(null);
    setService("");
    setCatalogStatus("loading");

    try {
      const response = await fetch("/api/homepage/catalog");
      if (!response.ok) {
        setCatalogStatus("error");
        return;
      }

      const catalog = (await response.json()) as HomepageCatalogResponse;
      const nextPlatforms = catalog.platforms.map(({ id, slug, name, logo }) => ({ id: slug, slug, name, logo }));
      const nextServicesByPlatform = groupHomepageServices(catalog.platforms, catalog.services);
      const nextPlatform = nextPlatforms.find((item) => item.id === selectedPlatformId.current) ?? nextPlatforms[0] ?? null;
      const nextServices = nextPlatform ? nextServicesByPlatform.get(nextPlatform.id) ?? [] : [];

      setPlatforms(nextPlatforms);
      setServicesByPlatform(nextServicesByPlatform);
      selectedPlatformId.current = nextPlatform?.id ?? null;
      setPlatform(nextPlatform);
      setService((current) => nextServices.some((item) => item.name === current) ? current : nextServices[0]?.name ?? "");
      setCatalogStatus(catalog.services.length > 0 ? "ready" : "empty");
    } catch {
      setCatalogStatus("error");
    } finally {
      requestInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void loadCatalog();
  }, [loadCatalog]);

  return <section className="services-showcase" id="services" aria-labelledby="services-heading">
    <header className="services-heading"><p className="section-kicker">BUILT FOR MOMENTUM</p><h2 id="services-heading">Grow faster<br />with our services</h2><p>Choose the platform and growth service that fits your next move. Clear pricing, simple setup, and no passwords.</p></header>
    <div className="platform-switch" role="tablist" aria-label="Platform services" aria-busy={catalogStatus === "loading"} style={catalogStatus === "loading" ? { minHeight: "110px" } : undefined}>{platforms.map((item) => <button key={item.id} className={platform?.id === item.id ? "active" : ""} onClick={() => { selectedPlatformId.current = item.id; setPlatform(item); setService(servicesByPlatform.get(item.id)?.[0]?.name ?? ""); }} role="tab" aria-selected={platform?.id === item.id}><span className="showcase-platform-logo">{getPlatformLogoUrl(item.id) ? <img src={getPlatformLogoUrl(item.id) ?? ""} alt="" /> : item.logo}</span><span className="showcase-platform-label">{item.name}<small>Services</small></span></button>)}</div>
    <div className="featured-service">
      <div className="service-tabs" role="tablist" aria-label="Service categories" aria-busy={catalogStatus === "loading"}>{services.map((item) => <button key={item.slug} className={service === item.name ? "active" : ""} onClick={() => setService(item.name)} role="tab" aria-selected={service === item.name}>{item.name}</button>)}</div>
      <div className="featured-content">
        <div className="featured-copy" aria-live="polite" aria-busy={catalogStatus === "loading"}>
          {catalogStatus === "loading" ? <p className="service-label">Loading available services…</p> : catalogStatus === "error" ? <><p className="service-label">Services temporarily unavailable</p><p>We’re having trouble loading the live catalog. Please try again.</p><div className="service-action"><button className="button button-solid" type="button" onClick={() => void loadCatalog()}>Try again</button></div></> : catalogStatus === "empty" || !platform || services.length === 0 ? <><p className="service-label">{platform ? `${platform.name} services` : "Services"}</p><p>{platform && catalogStatus !== "empty" ? "No active services are listed for this platform yet." : "No services are available right now. Please check back soon."}</p></> : <>
            <p className="service-label">{platform.name} / {service}</p>
            <h3>{platform.name} {service}</h3>
            <p>Choose a quantity, add your public {service === "Followers" ? "username" : "post or profile link"}, and we’ll handle the rest with precision.</p>
            <div className="service-action"><Link href={`/services/${services.find((item) => item.name === service)?.slug ?? ""}`}>Start growing <ArrowUpRight /></Link><span>Simple, secure checkout</span></div>
          </>}
        </div>
        <div className="service-art" aria-hidden="true"><div className="art-halo" /><img src="/hero.png" alt="" /></div>
      </div>
    </div>
  </section>;
}
