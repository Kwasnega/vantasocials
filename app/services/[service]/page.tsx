import Link from "next/link";
import { notFound } from "next/navigation";
import { ServiceConfigurator } from "../../../components/services/ServiceConfigurator";
import { getCustomerService } from "../../../lib/customer/service-contract";

export const dynamic = "force-dynamic";

export async function generateStaticParams() { return []; }

export default async function ServicePage({ params }: { params: Promise<{ service: string }> }) {
  const { service: slug } = await params;
  const service = await getCustomerService(slug);
  if (!service) notFound();
  return <main className="service-page"><Link href="/">VANTA</Link><p className="section-kicker">SERVICE</p><h1>{service.name}</h1><p>{service.inputFields.length > 0 ? "Configure the fields for this service." : "Configure your order with a public target and a quantity that fits your next move."}</p><ServiceConfigurator service={service} /></main>;
}
