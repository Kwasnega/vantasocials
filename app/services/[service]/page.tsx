import Link from "next/link";
import { notFound } from "next/navigation";
import { getService } from "../../../lib/catalog/services";
import { getPlatforms } from "../../../lib/catalog/platforms";
import { ServiceConfigurator } from "../../../components/services/ServiceConfigurator";
import { getPlatformLogoUrl } from "../../../lib/catalog/logo";

export const dynamic = "force-dynamic";

export async function generateStaticParams() { return []; }

export default async function ServicePage({ params }: { params: Promise<{ service: string }> }) {
  const { service: slug } = await params;
  const [service, platforms] = await Promise.all([getService(slug), getPlatforms()]);
  if (!service) notFound();
  const platform = platforms.find((item) => item.id === service.platform_id);
  const logoUrl = platform ? getPlatformLogoUrl(platform.slug) : null;
  return <div className={`order-builder-page service-theme-${slug}`}><div className="service-visual-orb" aria-hidden="true"><img className="service-orb-astronaut-image" src="/orb-astronaut.png" alt="" /></div><header className="order-builder-header"><Link className="order-back" href="/new-order">← Back to services</Link><div className="order-builder-eyebrow"><span className="platform-logo">{logoUrl ? <img src={logoUrl} alt={`${platform?.name ?? "VANTA"} logo`} /> : platform?.logo ?? "V"}</span><span>{platform?.name ?? "VANTA"} / {service.category}</span></div><h1>{service.name}</h1><p>{service.description || `Build momentum with ${service.name.toLowerCase()} through a clear, secure order flow.`}</p></header><ServiceConfigurator service={service} platform={platform?.name} /></div>;
}
