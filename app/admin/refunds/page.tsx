import { requireAdmin } from "../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../lib/supabase/server";
import { AdminRefundsClient, type RefundReportRow } from "./AdminRefundsClient";

export default async function AdminRefundsPage() {
  const { admin } = await requireAdmin();
  if (!admin) return null;

  const db = createSupabaseAdminClient();
  const initialDays = 30;
  const cutoff = new Date(Date.now() - initialDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: refunds } = await db
    .from("orders")
    .select(`
      id,
      public_order_id,
      total,
      currency,
      refund_amount,
      refunded_at,
      refunded_by,
      failure_reason,
      profiles(email),
      services(name)
    `)
    .eq("refund_status", "REFUNDED")
    .gte("refunded_at", cutoff)
    .order("refunded_at", { ascending: false })
    .limit(1000);

  const initialRows: RefundReportRow[] = (refunds || []).map((r) => {
    const isAuto = (r.refunded_by || "").startsWith("system:");
    return {
      id: r.id,
      publicOrderId: r.public_order_id,
      customerEmail: (r.profiles as { email?: string } | null)?.email || "—",
      serviceName: (r.services as { name?: string } | null)?.name || "—",
      amount: Number(r.refund_amount ?? r.total ?? 0),
      currency: r.currency,
      refundedAt: r.refunded_at,
      refundedBy: r.refunded_by || "—",
      mode: isAuto ? "AUTOMATIC" : "MANUAL",
      failureReason: r.failure_reason || "—",
    };
  });

  const initialTotal = initialRows.reduce((sum, r) => sum + r.amount, 0);

  return (
    <AdminRefundsClient
      initialDays={initialDays}
      initialCount={initialRows.length}
      initialTotal={initialTotal}
      initialRows={initialRows}
    />
  );
}
