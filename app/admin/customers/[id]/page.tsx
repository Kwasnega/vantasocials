import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../lib/supabase/server";
import { CustomerDetailTabs } from "../../../../components/admin/CustomerDetailTabs";

export default async function AdminCustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { admin } = await requireAdmin();
  if (!admin) return null;

  const { id: customerId } = await params;
  const db = createSupabaseAdminClient();

  // 1. Fetch customer profile
  const { data: customer, error: customerErr } = await db
    .from("profiles")
    .select("id,email,display_name,is_admin,account_status,account_status_reason,created_at,updated_at")
    .eq("id", customerId)
    .maybeSingle();

  if (customerErr || !customer) {
    notFound();
  }

  // Record admin access log
  await db.from("admin_action_log").insert({
    action: "CUSTOMER_DETAIL_VIEWED",
    performed_by: admin.id,
    performed_at: new Date().toISOString(),
    details: { customer_id: customerId, customer_email: customer.email },
  });

  // 2. Fetch financial records
  const [
    { data: walletData },
    { data: orders },
    { data: deposits },
    { data: walletTx },
    { data: notes },
    { data: statusHist },
    { data: adminsList },
  ] = await Promise.all([
    db.from("wallets").select("id,balance_minor,currency").eq("user_id", customerId).maybeSingle(),
    db.from("orders").select("id,public_order_id,quantity,total,currency,status,payment_status,fulfillment_status,failure_reason,refund_status,target_value,created_at,services(name,platforms(name))").eq("user_id", customerId).order("created_at", { ascending: false }).limit(100),
    db.from("wallet_deposit_payments").select("id,reference,amount_minor,currency,status,provider_response,paid_at,created_at").eq("user_id", customerId).order("created_at", { ascending: false }).limit(100),
    db.from("wallet_transactions").select("id,type,direction,status,amount_minor,currency,reference,order_id,metadata,created_at,wallets!inner(user_id)").eq("wallets.user_id", customerId).order("created_at", { ascending: false }).limit(100),
    db.from("customer_notes").select("id,category,status,body,order_id,created_at").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(100),
    db.from("customer_status_history").select("id,old_status,new_status,reason,created_at").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(50),
    db.from("profiles").select("id,email").eq("is_admin", true),
  ]);

  const adminEmailMap = new Map((adminsList || []).map((a) => [a.id, a.email]));

  // Ledger breakdown & reconciliation math (all values in GHS)
  let depositsCreditedGhs = 0;
  let manualCreditsGhs = 0;
  let refundsGhs = 0;
  let spentGhs = 0;

  (walletTx || []).forEach((t) => {
    if (t.status !== "COMPLETED") return;
    const amt = Number(t.amount_minor || 0) / 100;
    if (t.type === "DEPOSIT" && t.direction === "CREDIT") {
      depositsCreditedGhs += amt;
    } else if (t.type === "MANUAL_ADJUSTMENT" && t.direction === "CREDIT") {
      manualCreditsGhs += amt;
    } else if (t.type === "REFUND" && t.direction === "CREDIT") {
      refundsGhs += amt;
    } else if (t.type === "ORDER_DEBIT" && t.direction === "DEBIT") {
      spentGhs += amt;
    } else if (t.direction === "CREDIT") {
      // other credits
      depositsCreditedGhs += amt;
    } else if (t.direction === "DEBIT") {
      spentGhs += amt;
    }
  });

  const walletBalanceMinor = Number(walletData?.balance_minor ?? 0);
  const walletBalanceGhs = walletBalanceMinor / 100;

  // Formula: Deposits + Manual credits + Refunds - Spent = Expected Balance
  const expectedBalanceGhs = Number(
    (depositsCreditedGhs + manualCreditsGhs + refundsGhs - spentGhs).toFixed(2)
  );
  const balanceMatches = Math.abs(expectedBalanceGhs - walletBalanceGhs) < 0.01;

  // Uncredited deposits analysis (older than 30 mins)
  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
  const uncreditedDeposits = (deposits || []).filter((d) => d.status !== "PAID");
  const uncreditedDepositsCount = uncreditedDeposits.length;
  const uncreditedDepositsGhs = uncreditedDeposits.reduce(
    (acc, d) => acc + Number(d.amount_minor || 0) / 100,
    0
  );

  const staleUncreditedDeposits = uncreditedDeposits.filter(
    (d) => new Date(d.created_at) < thirtyMinsAgo
  );

  // Unpaid orders analysis
  const unpaidOrders = (orders || []).filter((o) => o.payment_status !== "PAID");
  const unpaidOrdersCount = unpaidOrders.length;
  const unpaidOrdersGhs = unpaidOrders.reduce((acc, o) => acc + Number(o.total || 0), 0);

  // Needs Attention criteria:
  // 1. Non-final deposits older than 30 minutes
  // 2. Unpaid orders exist
  // 3. Balance comes mostly or entirely from manual credits with no credited deposits
  const balanceIsMostlyManual =
    depositsCreditedGhs === 0 && manualCreditsGhs > 0 && walletBalanceGhs > 0;
  const needsAttention =
    staleUncreditedDeposits.length > 0 || unpaidOrdersCount > 0 || balanceIsMostlyManual || !balanceMatches;

  // Map ledger entries to deposit references for easy lookup
  const depositCreditTxMap = new Map<string, string>();
  (walletTx || []).forEach((t) => {
    if (t.type === "DEPOSIT" && t.direction === "CREDIT") {
      const meta = t.metadata as { deposit_id?: string; reference?: string } | null;
      if (meta?.deposit_id) depositCreditTxMap.set(meta.deposit_id, t.id);
      if (meta?.reference) depositCreditTxMap.set(meta.reference, t.id);
    }
  });

  // Formatted orders
  const formattedOrders = (orders || []).map((o) => {
    const service = o.services as { name?: string; platforms?: { name?: string } | null } | null;
    return {
      id: o.id,
      publicOrderId: o.public_order_id,
      serviceName: service?.name || "Service",
      platformName: service?.platforms?.name || "Platform",
      targetValue: o.target_value,
      quantity: o.quantity,
      total: Number(o.total || 0),
      currency: o.currency,
      status: o.status,
      paymentStatus: o.payment_status,
      fulfillmentStatus: o.fulfillment_status,
      failureReason: o.failure_reason,
      refundStatus: o.refund_status,
      createdAt: o.created_at,
    };
  });

  // Formatted deposits
  const formattedDeposits = (deposits || []).map((d) => {
    const pResp = (d.provider_response && typeof d.provider_response === "object" ? d.provider_response : {}) as Record<string, any>;
    const creditedLedgerTxId = depositCreditTxMap.get(d.id) || depositCreditTxMap.get(d.reference) || null;
    return {
      id: d.id,
      reference: d.reference,
      amount: Number(d.amount_minor || 0) / 100,
      currency: d.currency,
      status: d.status,
      paidAt: d.paid_at,
      createdAt: d.created_at,
      creditedToWallet: d.status === "PAID" || Boolean(creditedLedgerTxId),
      creditedLedgerTxId,
      lastCheck: pResp.last_check || null,
      isReconciled: Boolean(pResp.reconciled),
      reconciliationNote: pResp.reconciliation_note || null,
      linkedTransactionId: pResp.linked_transaction_id || null,
    };
  });

  // Formatted ledger
  const formattedLedger = (walletTx || []).map((t) => {
    const meta = (t.metadata && typeof t.metadata === "object" ? t.metadata : {}) as Record<string, any>;
    const adminEmail = meta.admin_id ? adminEmailMap.get(meta.admin_id) || meta.admin_id : null;
    return {
      id: t.id,
      type: t.type,
      direction: t.direction,
      amount: Number(t.amount_minor || 0) / 100,
      currency: t.currency,
      reference: t.reference,
      createdAt: t.created_at,
      category: meta.category || null,
      internalNote: meta.internal_note || meta.note || null,
      adminEmail,
      linkedOrderId: t.order_id || meta.order_id || null,
      linkedDepositId: meta.deposit_id || null,
    };
  });

  // Notes with optional linked order check
  const orderMap = new Map((orders || []).map((o) => [o.id, o]));
  const formattedNotes = (notes || []).map((n) => {
    const linked = n.order_id ? orderMap.get(n.order_id) : null;
    return {
      id: n.id,
      category: n.category,
      status: n.status,
      body: n.body,
      orderId: n.order_id,
      linkedOrderPublicId: linked ? linked.public_order_id : null,
      linkedOrderSummary: linked
        ? {
            paid: linked.payment_status === "PAID",
            fulfillmentStatus: linked.fulfillment_status,
            failureReason: linked.failure_reason,
            refundStatus: linked.refund_status,
            total: Number(linked.total || 0),
          }
        : null,
      createdAt: n.created_at,
    };
  });

  // Unified activity timeline
  const rawActivity: Array<{ id: string; type: string; title: string; description: string; timestamp: string }> = [];

  rawActivity.push({
    id: `acc-${customer.id}`,
    type: "account_created",
    title: "Account Created",
    description: `Customer account registered with email ${customer.email}`,
    timestamp: customer.created_at,
  });

  (deposits || []).forEach((d) => {
    const pResp = (d.provider_response && typeof d.provider_response === "object" ? d.provider_response : {}) as Record<string, any>;
    rawActivity.push({
      id: `dep-init-${d.id}`,
      type: "deposit_init",
      title: `Deposit Initiated (GHS ${(Number(d.amount_minor) / 100).toFixed(2)})`,
      description: `Paystack checkout generated with reference ${d.reference}. Status: ${d.status}`,
      timestamp: d.created_at,
    });
    if (d.status === "PAID") {
      rawActivity.push({
        id: `dep-paid-${d.id}`,
        type: "deposit_paid",
        title: `Deposit Confirmed & Credited (GHS ${(Number(d.amount_minor) / 100).toFixed(2)})`,
        description: `Paystack payment confirmed and credited to wallet.`,
        timestamp: d.paid_at || d.created_at,
      });
    }
    if (pResp.reconciled) {
      rawActivity.push({
        id: `dep-rec-${d.id}`,
        type: "deposit_reconciled",
        title: `Deposit Marked as Reconciled (${d.reference})`,
        description: `Admin marked as compensated: "${pResp.reconciliation_note || "Reconciled"}"`,
        timestamp: pResp.reconciled_at || d.created_at,
      });
    }
  });

  (walletTx || []).forEach((t) => {
    if (t.type === "MANUAL_ADJUSTMENT") {
      const meta = (t.metadata && typeof t.metadata === "object" ? t.metadata : {}) as Record<string, any>;
      const adminEmail = meta.admin_id ? adminEmailMap.get(meta.admin_id) || meta.admin_id : "Admin";
      rawActivity.push({
        id: `ledger-adj-${t.id}`,
        type: "manual_adjustment",
        title: `Manual Balance Adjustment (${t.direction === "CREDIT" ? "+" : "-"}GHS ${(Number(t.amount_minor) / 100).toFixed(2)})`,
        description: `Performed by ${adminEmail}. Category: ${meta.category || "manual"}. Note: "${meta.internal_note || "None"}"`,
        timestamp: t.created_at,
      });
    }
  });

  (orders || []).forEach((o) => {
    rawActivity.push({
      id: `ord-${o.id}`,
      type: "order_created",
      title: `Order Created (${o.public_order_id})`,
      description: `Order for ${o.quantity} units (Total GHS ${Number(o.total).toFixed(2)}). Payment: ${o.payment_status}, Fulfillment: ${o.fulfillment_status}`,
      timestamp: o.created_at,
    });
    if (o.refund_status === "REFUNDED") {
      rawActivity.push({
        id: `ref-${o.id}`,
        type: "refund",
        title: `Order Refunded (${o.public_order_id})`,
        description: `Refund credited back to customer wallet.`,
        timestamp: o.created_at,
      });
    }
  });

  (statusHist || []).forEach((h) => {
    rawActivity.push({
      id: `stat-${h.id}`,
      type: "status_changed",
      title: `Account Status Changed to ${h.new_status}`,
      description: `Reason: ${h.reason} (Previous: ${h.old_status})`,
      timestamp: h.created_at,
    });
  });

  rawActivity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <div className="admin-orders-page orders-redesign" style={{ maxWidth: "1280px", margin: "0 auto", padding: "20px" }}>
      {/* Needs-Attention Banner */}
      {needsAttention && (
        <section
          style={{
            marginBottom: "24px",
            padding: "16px 20px",
            borderRadius: "10px",
            backgroundColor: "rgba(245, 158, 11, 0.12)",
            border: "1px solid rgba(245, 158, 11, 0.35)",
            color: "#fef3c7",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, fontSize: "15px", color: "#fbbf24", marginBottom: "8px" }}>
            <span>⚠️</span> Needs Attention
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px" }}>
            {staleUncreditedDeposits.length > 0 && (
              <div>
                • <strong>{staleUncreditedDeposits.length} uncredited deposit(s)</strong> older than 30 minutes totaling <strong>GHS {uncreditedDepositsGhs.toFixed(2)}</strong> (check Deposits tab to verify with Paystack or reconcile).
              </div>
            )}
            {unpaidOrdersCount > 0 && (
              <div>
                • <strong>{unpaidOrdersCount} unpaid order(s)</strong> totaling <strong>GHS {unpaidOrdersGhs.toFixed(2)}</strong>.
              </div>
            )}
            {balanceIsMostlyManual && (
              <div>
                • <strong>Wallet balance is entirely from manual credits:</strong> Customer has GHS {walletBalanceGhs.toFixed(2)} balance from manual adjustments with 0 credited deposits.
              </div>
            )}
            {!balanceMatches && (
              <div style={{ color: "#fca5a5" }}>
                • <strong>Reconciliation Mismatch:</strong> Expected ledger balance does not equal current wallet balance!
              </div>
            )}
          </div>
        </section>
      )}

      {/* Financial Summary Cards */}
      <section className="dashboard-grid" style={{ marginBottom: "16px" }}>
        <article className="dashboard-card">
          <span>Deposits Credited</span>
          <strong style={{ fontSize: "20px", color: "#34d399" }}>
            GHS {depositsCreditedGhs.toFixed(2)}
          </strong>
          <small>{(deposits || []).filter((d) => d.status === "PAID").length} verified deposits</small>
        </article>

        <article className="dashboard-card">
          <span>Manual Credits</span>
          <strong style={{ fontSize: "20px", color: "#d883ff" }}>
            GHS {manualCreditsGhs.toFixed(2)}
          </strong>
          <small>Admin adjustments</small>
        </article>

        <article className="dashboard-card">
          <span>Refunds</span>
          <strong style={{ color: "#c084fc", fontSize: "20px" }}>
            GHS {refundsGhs.toFixed(2)}
          </strong>
          <small>Credited back to wallet</small>
        </article>

        <article className="dashboard-card">
          <span>Spent (Paid Orders)</span>
          <strong style={{ fontSize: "20px", color: "#f87171" }}>
            GHS {spentGhs.toFixed(2)}
          </strong>
          <small>Deducted from wallet</small>
        </article>

        <article className="dashboard-card">
          <span>Wallet Balance</span>
          <strong style={{ fontSize: "20px", color: "#60a5fa" }}>
            GHS {walletBalanceGhs.toFixed(2)}
          </strong>
          <small>{balanceMatches ? "✓ Ledger matches" : "⚠️ Mismatch detected"}</small>
        </article>
      </section>

      {/* One-line Reconciliation & Plain Language Insights */}
      <section
        style={{
          padding: "12px 16px",
          backgroundColor: "rgba(255, 255, 255, 0.03)",
          borderRadius: "8px",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          marginBottom: "24px",
          fontSize: "13px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>
          <div>
            <span style={{ color: "rgba(255,255,255,0.6)" }}>Reconciliation: </span>
            <code>
              Deposits (GHS {depositsCreditedGhs.toFixed(2)}) + Manual (GHS {manualCreditsGhs.toFixed(2)}) + Refunds (GHS {refundsGhs.toFixed(2)}) - Spent (GHS {spentGhs.toFixed(2)}) = GHS {expectedBalanceGhs.toFixed(2)}
            </code>
          </div>
          <div>
            {balanceMatches ? (
              <span style={{ color: "#34d399", fontWeight: 600 }}>✓ Formula matches current balance</span>
            ) : (
              <span style={{ color: "#f87171", fontWeight: 700 }}>⚠️ MISMATCH (Diff: GHS {(walletBalanceGhs - expectedBalanceGhs).toFixed(2)})</span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: "24px", marginTop: "10px", color: "rgba(255,255,255,0.75)", fontSize: "12px" }}>
          <div>
            <strong>Deposits not credited:</strong> {uncreditedDepositsCount} (GHS {uncreditedDepositsGhs.toFixed(2)})
          </div>
          <div>
            <strong>Unpaid orders:</strong> {unpaidOrdersCount} (GHS {unpaidOrdersGhs.toFixed(2)})
          </div>
        </div>
      </section>

      {/* Tabs */}
      <CustomerDetailTabs
        customerId={customer.id}
        customerEmail={customer.email}
        currentStatus={customer.account_status || "ACTIVE"}
        statusReason={customer.account_status_reason}
        orders={formattedOrders}
        deposits={formattedDeposits}
        ledger={formattedLedger}
        notes={formattedNotes}
        activity={rawActivity}
        ledgerSumGhs={expectedBalanceGhs}
        currentWalletBalanceGhs={walletBalanceGhs}
        balanceMatches={balanceMatches}
      />

      <div style={{ marginTop: "30px", display: "flex", gap: "20px" }}>
        <Link href="/admin/customers" style={{ color: "rgba(255,255,255,0.6)", textDecoration: "none", fontSize: "13px" }}>
          ← Back to customers
        </Link>
        <Link href="/admin/wallet/stuck-deposits" style={{ color: "#a5b4fc", textDecoration: "none", fontSize: "13px" }}>
          Go to Stuck Deposits Reconciliation Tool →
        </Link>
      </div>
    </div>
  );
}
