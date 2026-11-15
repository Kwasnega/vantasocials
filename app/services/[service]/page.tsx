import Link from "next/link";
import { notFound } from "next/navigation";
import { ServiceConfigurator } from "../../../components/services/ServiceConfigurator";
import { getPlatformLogoUrl } from "../../../lib/catalog/logo";
import { getPlatforms } from "../../../lib/catalog/platforms";
import { getCustomerService } from "../../../lib/customer/service-contract-server";
import { getServiceBlockStatus } from "../../../lib/provider-balance/service-block";

export const dynamic = "force-dynamic";

export async function generateStaticParams() { return []; }

export default async function ServicePage({ params }: { params: Promise<{ service: string }> }) {
  const { service: slug } = await params;
  const [service, platforms] = await Promise.all([getCustomerService(slug), getPlatforms()]);
  if (!service) notFound();
  const platform = platforms.find((item) => item.id === service.platform_id);
  const logoUrl = platform ? getPlatformLogoUrl(platform.slug) : null;

  // Setting-guarded provider-balance block (default OFF; never silently blocks)
  const blockStatus = await getServiceBlockStatus({ serviceId: service.id });

  return <div className={`order-builder-page service-theme-${slug}`}>
    <div className="service-visual-orb" aria-hidden="true"><img className="service-orb-astronaut-image" src="/orb-astronaut.png" alt="" /></div>
    <header className="order-builder-header">
      <Link className="order-back" href="/new-order">← Back to services</Link>
      <div className="order-builder-eyebrow">
        <span className="platform-logo">{logoUrl ? <img src={logoUrl} alt={`${platform?.name ?? "VANTA"} logo`} /> : platform?.logo ?? "V"}</span>
        <span>{platform?.name ?? "VANTA"} / {service.category}</span>
      </div>
      <h1>{service.name}</h1>
      <p>{service.description || `Build momentum with ${service.name.toLowerCase()} through a clear, secure order flow.`}</p>
    </header>
    {blockStatus.blocked ? (
      <div className="service-unavailable-notice" role="status">
        <p>{blockStatus.message}</p>
      </div>
    ) : (
      <ServiceConfigurator service={service} platform={platform?.name} platformSlug={platform?.slug} />
    )}
  </div>;
}
