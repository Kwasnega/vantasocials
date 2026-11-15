import { redirect } from "next/navigation";
import { requireAdmin } from "../../../lib/admin/auth";
import { getCachedFailureAnalytics, windowKeyToHours } from "../../../lib/admin/failures/analytics";
import { FailuresViewClient } from "./FailuresViewClient";

export const dynamic = "force-dynamic";

export default async function AdminFailuresPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const { user, admin } = await requireAdmin();
  if (!user) redirect("/login?next=/admin/failures");
  if (!admin) redirect("/admin");

  const params = await searchParams;
  const activeWindow = params.window === "24h" || params.window === "30d" ? params.window : "7d";
  const hours = windowKeyToHours(activeWindow);

  const data = await getCachedFailureAnalytics(hours);

  return (
    <div className="admin-overview">
      <FailuresViewClient data={data} activeWindow={activeWindow} />
    </div>
  );
}
