import "server-only";
import { redirect } from "next/navigation";
import { requireAdmin } from "../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../lib/supabase/server";
export default async function AdminPricingPage() {
  const { user, admin } = await requireAdmin(); if (!user || !admin) redirect("/");
  const db = createSupabaseAdminClient();
  const [{ data: services }, { data: setting }] = await Promise.all([db.from("services").select("slug,name,selling_rate,currency,provider,provider_service_id,provider_rate,provider_rate_unit,provider_currency").order("slug"), db.from("pricing_settings").select("fx_rate").eq("key", "USD_GHS").maybeSingle()]);
  const fxRate = setting?.fx_rate == null ? null : String(setting.fx_rate);
  return <main className="admin-pricing-page"><h1>Admin pricing</h1><p>Provider economics are internal and do not change customer prices automatically.</p><table><thead><tr><th>Service</th><th>Selling price</th><th>Provider</th><th>Provider rate</th><th>Unit</th></tr></thead><tbody>{(services ?? []).map((service) => <tr key={service.slug}><td>{service.name} ({service.slug})</td><td>{service.selling_rate} {service.currency}</td><td>{service.provider ?? "—"} {service.provider_service_id ?? ""}</td><td>{service.provider_rate ?? "—"} {service.provider_rate ? service.provider_currency ?? "USD" : ""}</td><td>{service.provider_rate_unit ?? "—"}</td></tr>)}</tbody></table></main>;
}
