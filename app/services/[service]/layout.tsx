import { AuthenticatedDashboardLayout } from "../../../components/dashboard/AuthenticatedDashboardLayout";

export default async function ServiceLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthenticatedDashboardLayout nextPath="/new-order" loadingVariant="service">
      {children}
    </AuthenticatedDashboardLayout>
  );
}
