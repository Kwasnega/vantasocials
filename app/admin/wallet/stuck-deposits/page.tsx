import Link from "next/link";
import { requireAdmin } from "../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../lib/supabase/server";
import { StuckDepositsTable } from "./StuckDepositsTable";

export default async function StuckDepositsPage() {
  const { admin } = await requireAdmin();
  if (!admin) return null;

  const db = createSupabaseAdminClient();
  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const { data: deposits, error } = await db
    .from("wallet_deposit_payments")
    .select(`
      id,
      user_id,
      wallet_id,
      reference,
      amount_minor,
      currency,
      status,
      created_at,
      provider_response,
      profiles:user_id (
        id,
        email
      )
    `)
    .not("status", "in", '("PAID","FAILED","ABANDONED")')
    .lt("created_at", thirtyMinsAgo)
    .order("created_at", { ascending: false });

  const formatted = (deposits || []).map((d: any) => {
    const pResp = (d.provider_response && typeof d.provider_response === "object" ? d.provider_response : {}) as Record<string, any>;
    return {
      id: d.id,
      userId: d.user_id,
      userEmail: d.profiles?.email || "Unknown",
      reference: d.reference,
      amount: Number(d.amount_minor || 0) / 100,
      currency: d.currency,
      status: d.status,
      createdAt: d.created_at,
      lastCheck: pResp.last_check || null,
      isReconciled: Boolean(pResp.reconciled),
      reconciliationNote: pResp.reconciliation_note || null,
    };
  });

  return (
    <div className="admin-orders-page orders-redesign" style={{ maxWidth: "1280px", margin: "0 auto", padding: "20px" }}>
      <header className="dashboard-header" style={{ marginBottom: "20px" }}>
        <div>
          <p className="dashboard-kicker">WALLET RECONCILIATION</p>
          <h1 style={{ margin: "4px 0", fontSize: "24px" }}>Stuck Deposits</h1>
          <p style={{ color: "rgba(255,255,255,0.6)", fontSize: "13px", margin: 0 }}>
            Wallet deposits in a non-final state (older than 30 minutes). Check status directly against Paystack to identify payments that were completed but never credited.
          </p>
        </div>
      </header>

      {error ? (
        <div style={{ color: "#f87171", padding: "16px", backgroundColor: "rgba(239, 68, 68, 0.1)", borderRadius: "8px" }}>
          Error loading deposits: {error.message}
        </div>
      ) : (
        <StuckDepositsTable initialDeposits={formatted} />
      )}

      <div style={{ marginTop: "30px" }}>
        <Link href="/admin/customers" style={{ color: "rgba(255,255,255,0.6)", textDecoration: "none", fontSize: "13px" }}>
          ← Back to customers
        </Link>
      </div>
    </div>
  );
}
