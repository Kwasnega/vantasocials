"use client";

import { useEffect, useState } from "react";
import { getPlatforms, getServicesByPlatform } from "../../data/catalog";

type ShowcasePlatform = { id: string; name: string; logo: string };
type ShowcaseService = { name: string; platformId: string; slug: string };

const ArrowUpRight = () => <span aria-hidden="true" className="arrow">&#8599;</span>;

export function ServicesShowcase() {
  const fallbackPlatforms: ShowcasePlatform[] = getPlatforms();
  const fallbackServices: ShowcaseService[] = fallbackPlatforms.flatMap((item) => getServicesByPlatform(item.id));
  const [platforms, setPlatforms] = useState<ShowcasePlatform[]>(fallbackPlatforms);
  const [catalogServices, setCatalogServices] = useState<ShowcaseService[]>(fallbackServices);
  const [platform, setPlatform] = useState<ShowcasePlatform>(fallbackPlatforms[0]);
  const [service, setService] = useState(fallbackServices[0].name);
  const services = catalogServices.filter((item) => item.platformId === platform.id);

  useEffect(() => {
    async function loadCatalog() {
      const [platformResponse, serviceResponse] = await Promise.all([fetch("/api/platforms"), fetch("/api/services")]);
      if (!platformResponse.ok || !serviceResponse.ok) return;
      const databasePlatforms: Array<{ id: string; slug: string; name: string; logo: string }> = await platformResponse.json();
      const databaseServices: Array<{ platform_id: string; name: string; slug: string }> = await serviceResponse.json();
      const platformSlugById = new Map(databasePlatforms.map((item) => [item.id, item.slug]));
      const nextPlatforms = databasePlatforms.map(({ slug, name, logo }) => ({ id: slug, name, logo }));
      const nextServices = databaseServices.flatMap((item) => {
        const platformId = platformSlugById.get(item.platform_id);
        return platformId ? [{ name: item.name, slug: item.slug, platformId }] : [];
      });
      if (!nextPlatforms.length || !nextServices.length) return;
      setPlatforms(nextPlatforms);
      setCatalogServices(nextServices);
      setPlatform((current) => nextPlatforms.find((item) => item.id === current.id) ?? nextPlatforms[0]);
    }
    void loadCatalog();
  }, []);

  return <section className="services-showcase" id="services" aria-labelledby="services-heading">
    <header className="services-heading"><p className="section-kicker">BUILT FOR MOMENTUM</p><h2 id="services-heading">Grow faster<br />with our services</h2><p>Choose the platform and growth service that fits your next move. Clear pricing, simple setup, and no passwords.</p></header>
    <div className="platform-switch" role="tablist" aria-label="Platform services">{platforms.map((item) => <button key={item.id} className={platform.id === item.id ? "active" : ""} onClick={() => { setPlatform(item); setService(catalogServices.find((entry) => entry.platformId === item.id)?.name ?? ""); }} role="tab" aria-selected={platform.id === item.id}><span>{item.logo}</span>{item.name} services</button>)}</div>
    <div className="featured-service"><div className="service-tabs" role="tablist" aria-label="Service categories">{services.map((item) => <button key={item.slug} className={service === item.name ? "active" : ""} onClick={() => setService(item.name)} role="tab" aria-selected={service === item.name}>{item.name}</button>)}</div><div className="featured-content"><div className="featured-copy"><p className="service-label">{platform.name} / {service}</p><h3>{platform.name} {service}</h3><p>Choose a quantity, add your public {service === "Followers" ? "username" : "post or profile link"}, and we’ll handle the rest with precision.</p><div className="service-action"><a href={`/services/${services.find((item) => item.name === service)?.slug ?? ""}`}>Start growing <ArrowUpRight /></a><span>Simple, secure checkout</span></div></div><div className="service-art" aria-hidden="true"><div className="art-halo" /><img src="/hero.png" alt="" /></div></div></div>
  </section>;
}
