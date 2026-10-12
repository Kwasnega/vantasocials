import { AuthenticatedDashboardLayout } from "../../components/dashboard/AuthenticatedDashboardLayout";

export default async function NewOrderLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthenticatedDashboardLayout nextPath="/new-order" loadingVariant="catalog">
      {children}
    </AuthenticatedDashboardLayout>
  );
}
