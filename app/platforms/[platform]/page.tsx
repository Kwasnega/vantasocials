import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlatform, getServicesByPlatform, platforms } from "../../../data/catalog";

export function generateStaticParams() { return platforms.map((platform) => ({ platform: platform.slug })); }

export default async function PlatformPage({ params }: { params: Promise<{ platform: string }> }) {
  const { platform: slug } = await params;
  const platform = getPlatform(slug);
  if (!platform) notFound();
  const services = getServicesByPlatform(platform.id);
  return <main className="platform-page"><Link href="/">VANTA</Link><header><span className="platform-logo">{platform.logo}</span><p className="section-kicker">PLATFORM SERVICES</p><h1>{platform.name}</h1><p>{platform.description}</p></header><div className="platform-service-grid">{services.map((service) => <Link className="platform-service-card" href={`/services/${service.slug}`} key={service.id}><span>{service.category}</span><b>Start growing ↗</b></Link>)}</div></main>;
}
