import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoutButton } from "../../components/auth/LogoutButton";
import { requireAdmin } from "../../lib/admin/auth";
import { AdminSidebar } from "../../components/admin/AdminSidebar";
import { ProviderBalanceBanner } from "../../components/admin/ProviderBalanceBanner";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, admin } = await requireAdmin();
  if (!user) redirect("/login?next=/admin");
  if (!admin) {
    return (
      <main className="admin-access-denied">
        <section className="admin-access-card" role="alert">
          <p className="dashboard-kicker">VANTA ADMIN</p>
          <h1>Admin access required</h1>
          <p>
            You're signed in, but this account does not have admin permissions.
            Ask an existing admin to enable access, or sign in with an admin account.
          </p>
          <div className="admin-access-actions">
            <Link href="/account">Return to your account</Link>
            <LogoutButton />
          </div>
        </section>
      </main>
    );
  }
  return (
    <main className="dashboard-shell" style={{ display: "grid", gridTemplateColumns: "minmax(0, 250px) minmax(0, 1fr)", minHeight: "100vh", width: "100%", maxWidth: "100vw", overflowX: "clip" }}>
      <AdminSidebar />
      <section className="dashboard-content" style={{ minWidth: 0, width: "100%", maxWidth: "100%", boxSizing: "border-box" }}>
        <ProviderBalanceBanner />
        {children}
      </section>
    </main>
  );
}
