import { AuthenticatedDashboardLayout } from "../../components/dashboard/AuthenticatedDashboardLayout";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthenticatedDashboardLayout nextPath="/account" loadingVariant="dashboard">
      {children}
    </AuthenticatedDashboardLayout>
  );
}
