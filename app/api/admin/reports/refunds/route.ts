import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";

export async function GET(request: NextRequest) {
  const { admin } = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format");
  const windowDays = Math.max(1, Math.min(90, Number(searchParams.get("days") || 30)));

  const db = createSupabaseAdminClient();
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  // Fetch refunded orders within window
  const { data: refunds, error } = await db
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

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (refunds || []).map((r) => {
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

  const totalRefundAmount = rows.reduce((sum, r) => sum + r.amount, 0);

  if (format === "csv") {
    const headers = [
      "Refunded At",
      "Order ID",
      "Customer Email",
      "Service",
      "Amount GHS",
      "Triggered By",
      "Mode",
      "Failure Reason",
    ];
    const csvLines = [
      headers.join(","),
      ...rows.map((r) =>
        [
          `"${r.refundedAt || ""}"`,
          `"${r.publicOrderId}"`,
          `"${r.customerEmail}"`,
          `"${r.serviceName.replaceAll('"', '""')}"`,
          r.amount.toFixed(2),
          `"${r.refundedBy}"`,
          `"${r.mode}"`,
          `"${r.failureReason}"`,
        ].join(",")
      ),
    ];

    return new NextResponse(csvLines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="vanta-refunds-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return NextResponse.json({
    windowDays,
    count: rows.length,
    totalRefundAmount,
    rows,
  });
}
