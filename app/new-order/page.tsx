import Link from "next/link";
import { requireUser } from "../../lib/auth/require-user";
import { getPlatforms } from "../../lib/catalog/platforms";
import { getServices } from "../../lib/catalog/services";
import PlatformCatalog from "../../components/catalog/PlatformCatalog";

export default async function NewOrderPage() {
  await requireUser("/new-order");
  const [platforms, services] = await Promise.all([getPlatforms(), getServices()]);
  return <><header className="dashboard-header new-order-header"><p className="dashboard-kicker">NEW ORDER</p><h1>Choose a service.</h1><p>Choose a platform to explore the services available for your next move.</p></header><PlatformCatalog platforms={platforms} services={services} /></>;
}
