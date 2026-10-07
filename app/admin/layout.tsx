import { redirect } from "next/navigation";
import { requireAdmin } from "../../lib/admin/auth";
import { AdminSidebar } from "../../components/admin/AdminSidebar";

export default async function AdminLayout({ children }: { children: React.ReactNode }) { const { user, admin } = await requireAdmin(); if (!user) redirect("/login?next=/admin"); if (!admin) redirect("/"); return <main className="dashboard-shell"><AdminSidebar/><section className="dashboard-content">{children}</section></main>; }
