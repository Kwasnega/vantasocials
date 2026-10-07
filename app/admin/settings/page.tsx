import Link from "next/link";
import { requireAdmin } from "../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../lib/supabase/server";
import { FxRateForm } from "../pricing/FxRateForm";

const settings = [
  { icon: "◈", label: "Workspace", title: "Admin workspace", text: "Review the control center and keep your VANTA operations organized.", href: "/admin" },
  { icon: "◎", label: "Catalog", title: "Services & platforms", text: "Manage customer-facing services, publishing, and provider mappings.", href: "/admin/services" },
  { icon: "◌", label: "Pricing", title: "Pricing controls", text: "Update exchange rates and review the pricing rules used at checkout.", href: "/admin/pricing" },
  { icon: "↗", label: "Operations", title: "Provider operations", text: "Monitor provider balance, catalog sync, and fulfillment health.", href: "/admin/providers/reliablesmm" },
];

export default async function AdminSettingsPage() {
  const { admin } = await requireAdmin(); if (!admin) return null;
  const db = createSupabaseAdminClient(); const { data: setting } = await db.from("pricing_settings").select("fx_rate").eq("key", "USD_GHS").maybeSingle();
  return <div className="admin-settings-page"><header className="admin-settings-hero"><div><p className="dashboard-kicker">ADMIN / CONTROL CENTER</p><h1>Settings<span>.</span></h1><p>Configure the parts of VANTA that keep your catalog, pricing, and provider operations moving.</p></div><div className="admin-settings-mark" aria-hidden="true">V</div></header><section className="admin-settings-intro"><div><p className="dashboard-kicker">SYSTEM SETTINGS</p><h2>Everything in one place.</h2></div><span>4 areas</span></section><div className="admin-settings-grid">{settings.map((item) => <Link className="admin-setting-card" href={item.href} key={item.title}><span className="admin-setting-icon" aria-hidden="true">{item.icon}</span><div><p>{item.label}</p><h3>{item.title}</h3><span>{item.text}</span></div><b aria-hidden="true">↗</b></Link>)}</div><FxRateForm initialValue={setting?.fx_rate == null ? null : String(setting.fx_rate)} /><section className="admin-settings-note"><span className="admin-settings-note-icon">!</span><div><p className="dashboard-kicker">ACCESS & SAFETY</p><h2>Changes are intentionally scoped.</h2><p>Settings that affect money movement, customer access, or provider fulfillment stay behind their dedicated admin workflows.</p></div></section></div>;
}
