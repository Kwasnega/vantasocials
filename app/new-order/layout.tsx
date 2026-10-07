import { AccountSidebar } from "../../components/dashboard/AccountSidebar";
import { requireUser } from "../../lib/auth/require-user";

export default async function NewOrderLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser("/new-order");
  return <main className="dashboard-shell"><AccountSidebar email={user.email ?? ""} /><section className="dashboard-content">{children}</section></main>;
}
