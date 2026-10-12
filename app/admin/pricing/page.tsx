import "server-only";
import { redirect } from "next/navigation";
import { requireAdmin } from "../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../lib/supabase/server";
import { AdminEmptyState, AdminQueryError } from "../AdminDataState";
import { AdminPricingTable } from "./AdminPricingTable";

type PricingServiceRow = {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  selling_rate: string | number;
  currency: string;
  provider: string | null;
  provider_service_id: string | null;
  provider_rate: string | number | null;
  provider_rate_unit: string | null;
  provider_currency: string | null;
  platforms: { id: string; name: string; slug: string } | Array<{ id: string; name: string; slug: string }> | null;
};

export default async function AdminPricingPage() {
  const { user, admin } = await requireAdmin();
  if (!user || !admin) redirect("/");
  const db = createSupabaseAdminClient();
  const [
    { data: services, error: servicesError },
    { data: setting, error: settingError },
  ] = await Promise.all([
    db.from("services").select("id,slug,name,active,selling_rate,currency,provider,provider_service_id,provider_rate,provider_rate_unit,provider_currency,platforms(id,name,slug)").order("slug"),
    db.from("pricing_settings").select("fx_rate").eq("key", "USD_GHS").maybeSingle(),
  ]);
  const normalizedServices = ((services ?? []) as PricingServiceRow[]).map((service) => ({
    ...service,
    platform: Array.isArray(service.platforms) ? service.platforms[0] ?? null : service.platforms,
  }));
  const fxRate = settingError || setting?.fx_rate == null ? null : String(setting.fx_rate);

  return (
    <main className="admin-pricing-page">
      <header className="pricing-hero">
        <div>
          <p className="dashboard-kicker">ADMIN / REVENUE</p>
          <h1>Pricing<span>.</span></h1>
          <p>Review customer selling prices alongside provider costs and billing units.</p>
        </div>
        <div className="pricing-hero-mark" aria-hidden="true">₵</div>
      </header>
      <p className="pricing-contract-note">
        Customer prices are displayed in GHS per 1,000 units. This page is for reviewing prices;
        make changes from <a href="/admin/services">Admin Services</a>. Provider cost estimates
        are internal and do not change customer prices.
      </p>
      {settingError && <AdminQueryError message="Exchange-rate settings could not be loaded. Provider cost estimates are unavailable." />}
      {servicesError ? (
        <AdminQueryError message="Service pricing records could not be loaded." />
      ) : normalizedServices.length ? (
        <AdminPricingTable services={normalizedServices} fxRate={fxRate} />
      ) : (
        <AdminEmptyState message="No service pricing records found." />
      )}
    </main>
  );
}
