import Link from "next/link";
import { notFound } from "next/navigation";
import { getService } from "../../../lib/catalog/services";
import { ServiceConfigurator } from "../../../components/services/ServiceConfigurator";

export async function generateStaticParams() { return []; }

export default async function ServicePage({ params }: { params: Promise<{ service: string }> }) {
  const { service: slug } = await params;
  const service = await getService(slug);
  if (!service) notFound();
  return <main className="service-page"><Link href="/">VANTA</Link><p className="section-kicker">SERVICE</p><h1>{service.name}</h1><p>Configure your order with a public target and a quantity that fits your next move.</p><ServiceConfigurator service={service} /></main>;
}
