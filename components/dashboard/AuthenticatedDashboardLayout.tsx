import { Suspense } from "react";
import { AccountSidebar } from "./AccountSidebar";
import { CustomerRouteLoading, type CustomerLoadingVariant } from "./CustomerRouteLoading";
import { requireUser } from "../../lib/auth/require-user";

export function AuthenticatedDashboardLayout({
  children,
  nextPath,
  loadingVariant,
}: {
  children: React.ReactNode;
  nextPath: string;
  loadingVariant: CustomerLoadingVariant;
}) {
  return (
    <main className="dashboard-shell">
      <Suspense fallback={<DashboardLoading variant={loadingVariant} />}>
        <AuthorizedDashboard nextPath={nextPath}>{children}</AuthorizedDashboard>
      </Suspense>
    </main>
  );
}

async function AuthorizedDashboard({
  children,
  nextPath,
}: {
  children: React.ReactNode;
  nextPath: string;
}) {
  const { user } = await requireUser(nextPath);
  return (
    <>
      <AccountSidebar email={user.email ?? ""} />
      <section className="dashboard-content">{children}</section>
    </>
  );
}

function DashboardLoading({ variant }: { variant: CustomerLoadingVariant }) {
  return (
    <>
      <aside className="dashboard-sidebar customer-sidebar-loading" aria-hidden="true">
        <div className="dashboard-sidebar-top">
          <span className="customer-loading-placeholder customer-loading-brand" />
        </div>
        <span className="customer-loading-placeholder customer-loading-sidebar-label" />
        <div className="customer-loading-sidebar-links">
          {Array.from({ length: 5 }, (_, index) => (
            <span className="customer-loading-placeholder" key={index} />
          ))}
        </div>
      </aside>
      <section className="dashboard-content">
        <CustomerRouteLoading variant={variant} />
      </section>
    </>
  );
}
