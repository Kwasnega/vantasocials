import Link from "next/link";
import { requireUser } from "../../lib/auth/require-user";
import { getPlatforms } from "../../lib/catalog/platforms";
import { getServices } from "../../lib/catalog/services";

export default async function NewOrderPage() {
  await requireUser("/new-order");
  const [platforms, services] = await Promise.all([getPlatforms(), getServices()]);
  return <main className="service-page"><Link href="/account">VANTA</Link><p className="section-kicker">NEW ORDER</p><h1>Choose a service.</h1><p>Catalog and pricing are loaded from the active customer catalog.</p><div className="platform-service-grid">{platforms.map((platform) => <section className="dashboard-card" key={platform.id}><h2>{platform.name}</h2><p>{platform.description}</p><ul className="dashboard-list">{services.filter((service) => service.platform_id === platform.id && service.active).map((service) => <li key={service.id}><span>{service.name} · {service.min_quantity}–{service.max_quantity}</span><Link href={`/services/${service.slug}`}>Configure</Link></li>)}</ul></section>)}</div></main>;
}
