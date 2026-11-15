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

  // 2. Fetch financial summary via atomic RPC or fallback calculation
  let summary: {
    wallet_balance_ghs?: number;
    wallet_currency?: string;
    total_deposited_ghs?: number;
    successful_deposits_count?: number;
    first_deposit_at?: string | null;
    last_deposit_at?: string | null;
    total_spent_ghs?: number;
    total_refunded_ghs?: number;
    refunds_count?: number;
    net_spent_ghs?: number;
    ledger_derived_balance_minor?: number;
    projected_balance_minor?: number;
    balance_matches?: boolean;
    total_orders_count?: number;
    completed_orders_count?: number;
    failed_orders_count?: number;
    open_complaints_count?: number;
  } | null = null;

  try {
    const { data: summaryRows, error: summaryErr } = await db.rpc("get_customer_financial_summary", {
      p_customer_id: customerId,
    });
    if (!summaryErr && summaryRows) {
      summary = Array.isArray(summaryRows) ? summaryRows[0] : summaryRows;
    }
  } catch (e) {
    console.warn("[AdminCustomerDetailPage] RPC exception:", e);
  }

  // 3. Parallel fetch of tabs data
  const [
    { data: walletData },
    { data: orders },
    { data: deposits },
    { data: walletTx },
    { data: notes },
    { data: statusHist },
  ] = await Promise.all([
    db.from("wallets").select("id,balance_minor,currency").eq("user_id", customerId).maybeSingle(),
    db.from("orders").select("id,public_order_id,quantity,total,currency,status,payment_status,fulfillment_status,failure_reason,refund_status,target_value,created_at,services(name,platforms(name))").eq("user_id", customerId).order("created_at", { ascending: false }).limit(100),
    db.from("wallet_deposit_payments").select("id,reference,amount_minor,currency,status,paid_at,created_at").eq("user_id", customerId).order("created_at", { ascending: false }).limit(100),
    db.from("wallet_transactions").select("id,type,direction,status,amount_minor,currency,reference,created_at,wallets!inner(user_id)").eq("wallets.user_id", customerId).order("created_at", { ascending: false }).limit(100),
    db.from("customer_notes").select("id,category,status,body,order_id,created_at").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(100),
    db.from("customer_status_history").select("id,old_status,new_status,reason,created_at").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(50),
  ]);

  // If RPC failed or was unauthorized, calculate summary values directly from verified data
  if (!summary) {
    const successfulDeposits = (deposits || []).filter(
      (d) => d.status === "COMPLETED" || d.status === "PAID"
    );
    const totalDepositedMinor = successfulDeposits.reduce((acc, d) => acc + Number(d.amount_minor || 0), 0);

    const paidOrdersList = (orders || []).filter((o) => o.payment_status === "PAID");
    const totalSpent = paidOrdersList.reduce((acc, o) => acc + Number(o.total || 0), 0);

    const refundedOrdersList = (orders || []).filter((o) => o.refund_status === "REFUNDED");
    const totalRefunded = refundedOrdersList.reduce((acc, o) => acc + Number(o.total || 0), 0);

    const walletBalanceMinor = Number(walletData?.balance_minor ?? 0);

    // Compute ledger-derived balance
    const ledgerBalanceMinor = (walletTx || []).reduce((acc, t) => {
      if (t.status !== "COMPLETED") return acc;
      const amt = Number(t.amount_minor || 0);
      return t.direction === "CREDIT" ? acc + amt : acc - amt;
    }, 0);

    summary = {
      wallet_balance_ghs: walletBalanceMinor / 100,
      wallet_currency: walletData?.currency || "GHS",
      total_deposited_ghs: totalDepositedMinor / 100,
      successful_deposits_count: successfulDeposits.length,
      total_spent_ghs: totalSpent - totalRefunded,
      total_refunded_ghs: totalRefunded,
      refunds_count: refundedOrdersList.length,
      net_spent_ghs: totalSpent - totalRefunded,
      ledger_derived_balance_minor: ledgerBalanceMinor,
      projected_balance_minor: walletBalanceMinor,
      balance_matches: ledgerBalanceMinor === walletBalanceMinor,
      total_orders_count: (orders || []).length,
      completed_orders_count: (orders || []).filter((o) => o.fulfillment_status === "COMPLETED").length,
      failed_orders_count: (orders || []).filter((o) => o.fulfillment_status === "FAILED").length,
      open_complaints_count: (notes || []).filter((n) => n.status === "open" && n.category === "complaint").length,
    };
  }

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
  const formattedDeposits = (deposits || []).map((d) => ({
    id: d.id,
    reference: d.reference,
    amount: Number(d.amount_minor || 0) / 100,
    currency: d.currency,
    status: d.status,
    paidAt: d.paid_at,
    createdAt: d.created_at,
  }));

  // Formatted ledger
  const formattedLedger = (walletTx || []).map((t) => ({
    id: t.id,
    type: t.type,
    direction: t.direction,
    amount: Number(t.amount_minor || 0) / 100,
    currency: t.currency,
    reference: t.reference,
    createdAt: t.created_at,
  }));

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

  // Unified activity timeline built strictly from persisted rows
  const rawActivity: Array<{ id: string; type: string; title: string; description: string; timestamp: string }> = [];

  rawActivity.push({
    id: `acc-${customer.id}`,
    type: "account_created",
    title: "Account Created",
    description: `Customer account registered with email ${customer.email}`,
    timestamp: customer.created_at,
  });

  (deposits || []).forEach((d) => {
    if (d.status === "COMPLETED") {
      rawActivity.push({
        id: `dep-${d.id}`,
        type: "deposit",
        title: `Deposit Credited (GHS ${(Number(d.amount_minor) / 100).toFixed(2)})`,
        description: `Paystack deposit reference ${d.reference} was completed.`,
        timestamp: d.paid_at || d.created_at,
      });
    }
  });

  (orders || []).forEach((o) => {
    rawActivity.push({
      id: `ord-${o.id}`,
      type: "order_created",
      title: `Order Placed (${o.public_order_id})`,
      description: `Order for ${o.quantity} units (Total GHS ${Number(o.total).toFixed(2)}). Status: ${o.fulfillment_status}`,
      timestamp: o.created_at,
    });
    if (o.refund_status === "REFUNDED") {
      rawActivity.push({
        id: `ref-${o.id}`,
        type: "refund",
        title: `Order Refunded (${o.public_order_id})`,
        description: `Refund credited back to customer wallet.`,
        timestamp: o.created_at, // chronological point
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

  const walletBalanceGhs = Number(summary?.wallet_balance_ghs ?? 0);
  const totalDepositedGhs = Number(summary?.total_deposited_ghs ?? 0);
  const totalSpentGhs = Number(summary?.total_spent_ghs ?? 0);
  const totalRefundedGhs = Number(summary?.total_refunded_ghs ?? 0);
  const balanceMatches = Boolean(summary?.balance_matches ?? true);
  const ledgerDerivedGhs = Number(summary?.ledger_derived_balance_minor ?? 0) / 100;

  return (
    <div className="admin-orders-page orders-redesign" style={{ maxWidth: "1200px", margin: "0 auto", padding: "20px" }}>
      {/* Financial Summary Cards */}
      <section className="dashboard-grid" style={{ marginBottom: "24px" }}>
        <article className="dashboard-card">
          <span>Wallet Balance</span>
          <strong style={{ color: "#48bb78", fontSize: "22px" }}>
            GHS {walletBalanceGhs.toFixed(2)}
          </strong>
          <small>{balanceMatches ? "✓ Ledger matches" : "⚠️ Ledger mismatch!"}</small>
        </article>

        <article className="dashboard-card">
          <span>Total Deposited</span>
          <strong style={{ fontSize: "22px" }}>
            GHS {totalDepositedGhs.toFixed(2)}
          </strong>
          <small>{summary?.successful_deposits_count ?? 0} successful deposits</small>
        </article>

        <article className="dashboard-card">
          <span>Total Spent</span>
          <strong style={{ fontSize: "22px" }}>
            GHS {totalSpentGhs.toFixed(2)}
          </strong>
          <small>Net of refunded orders</small>
        </article>

        <article className="dashboard-card">
          <span>Total Refunded</span>
          <strong style={{ color: "#c084fc", fontSize: "22px" }}>
            GHS {totalRefundedGhs.toFixed(2)}
          </strong>
          <small>{summary?.refunds_count ?? 0} refunded orders</small>
        </article>
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
        ledgerSumGhs={ledgerDerivedGhs}
        currentWalletBalanceGhs={walletBalanceGhs}
        balanceMatches={balanceMatches}
      />

      <div style={{ marginTop: "30px" }}>
        <Link href="/admin/customers" style={{ color: "rgba(255,255,255,0.6)", textDecoration: "none" }}>
          ← Back to customers
        </Link>
      </div>
    </div>
  );
}
