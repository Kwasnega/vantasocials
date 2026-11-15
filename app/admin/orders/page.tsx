import Link from "next/link";
import { requireAdmin } from "../../../lib/admin/auth";
import { escapePostgrestSearchTerm } from "../../../lib/admin/order-list";
import { createSupabaseAdminClient } from "../../../lib/supabase/server";
import { AdminEmptyState, AdminQueryError } from "../AdminDataState";
import { AdminFilterBar } from "../../../components/admin/AdminFilterBar";
import { parseOrderCursor } from "../../../lib/admin/cursor-validation";
import type { OrderFailureReason } from "../../../lib/fulfillment/failure-classifier";
import { AdminOrderRetryAction } from "../../../components/admin/AdminOrderRetryAction";
import { AdminBulkRetryAction } from "../../../components/admin/AdminBulkRetryAction";
import { AdminOrderRefundButton } from "../../../components/admin/AdminOrderRefundButton";
import { AdminBulkRefundAction } from "../../../components/admin/AdminBulkRefundAction";
import { getRetryEligibility } from "../../../lib/fulfillment/retry-eligibility";
import { getRefundEligibility } from "../../../lib/orders/refund-eligibility";

/** Build an orders page href including a cursor (for keyset pagination) */
function buildOrdersHref(
  search: string,
  payment?: string,
  fulfillment?: string,
  failureReason?: string,
  cursor?: string,
): string {
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  if (payment) params.set("payment", payment);
  if (fulfillment) params.set("fulfillment", fulfillment);
  if (failureReason) params.set("failure_reason", failureReason);
  if (cursor) params.set("cursor", cursor);
  return `/admin/orders?${params.toString()}`;
}

/** Badge appearance for each failure reason */
const FAILURE_REASON_BADGE: Record<OrderFailureReason, { label: string; color: string }> = {
  provider_insufficient_funds: { label: "Low Provider Balance", color: "#ff8c00" },
  provider_rejected:           { label: "Provider Rejected",    color: "#e53e3e" },
  invalid_target:              { label: "Bad Link/Target",       color: "#805ad5" },
  provider_timeout:            { label: "Timed Out",            color: "#d69e2e" },
  provider_unreachable:        { label: "Unreachable",          color: "#c05621" },
  internal_error:              { label: "Internal Error",       color: "#2b6cb0" },
  unknown:                     { label: "Unknown",              color: "#718096" },
};

/** Compact stage indicator mapping for quick visual lifecycle status */
const FULFILLMENT_STAGE_CONFIG: Record<
  string,
  { label: string; step: number; total: number; color: string }
> = {
  NOT_STARTED: { label: "Created", step: 1, total: 5, color: "#6b7280" },
  SUBMITTING:  { label: "Submitting", step: 2, total: 5, color: "#eab308" },
  SUBMITTED:   { label: "Submitted", step: 3, total: 5, color: "#3b82f6" },
  PROCESSING:  { label: "In Progress", step: 4, total: 5, color: "#06b6d4" },
  COMPLETED:   { label: "Completed", step: 5, total: 5, color: "#22c55e" },
  PARTIAL:     { label: "Partial", step: 4, total: 5, color: "#a855f7" },
  FAILED:      { label: "Failed", step: 0, total: 5, color: "#ef4444" },
  CANCELLED:   { label: "Cancelled", step: 0, total: 5, color: "#9ca3af" },
};

function OrderStageIndicator({ status }: { status: string }) {
  const stage = FULFILLMENT_STAGE_CONFIG[status] ?? {
    label: status,
    step: 0,
    total: 5,
    color: "#6b7280",
  };

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        fontSize: "11px",
        color: stage.color,
        fontWeight: 600,
      }}
    >
      <span
        style={{
          width: "7px",
          height: "7px",
          borderRadius: "50%",
          background: stage.color,
          boxShadow: `0 0 6px ${stage.color}88`,
          display: "inline-block",
        }}
      />
      <span>
        {stage.label}
        {stage.step > 0 && (
          <span style={{ fontSize: "10px", opacity: 0.7, marginLeft: "4px" }}>
            ({stage.step}/{stage.total})
          </span>
        )}
      </span>
    </div>
  );
}

function FailureReasonBadge({ reason }: { reason: string }) {
  const badge = FAILURE_REASON_BADGE[reason as OrderFailureReason];
  if (!badge) return null;
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: "10px",
        fontWeight: 700,
        letterSpacing: "0.04em",
        padding: "2px 7px",
        borderRadius: "6px",
        background: badge.color + "22",
        color: badge.color,
        border: `1px solid ${badge.color}44`,
        marginTop: "3px",
        whiteSpace: "nowrap",
      }}
    >
      {badge.label}
    </span>
  );
}

function FailureReasonChip({
  reason,
  count,
  active,
  href,
}: {
  reason: OrderFailureReason;
  count: number;
  active: boolean;
  href: string;
}) {
  const badge = FAILURE_REASON_BADGE[reason];
  return (
    <Link
      prefetch={false}
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        fontSize: "12px",
        fontWeight: active ? 800 : 600,
        padding: "4px 10px",
        borderRadius: "8px",
        background: active ? badge.color + "33" : "rgba(255,255,255,0.05)",
        color: active ? badge.color : "#aaa",
        border: `1px solid ${active ? badge.color + "66" : "rgba(255,255,255,0.1)"}`,
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: badge.color,
          display: "inline-block",
          flexShrink: 0,
        }}
      />
      {badge.label}
      <span
        style={{
          background: "rgba(255,255,255,0.12)",
          borderRadius: "4px",
          padding: "0 4px",
          fontSize: "11px",
        }}
      >
        {count}
      </span>
    </Link>
  );
}

const FAILURE_REASONS: OrderFailureReason[] = [
  "provider_insufficient_funds",
  "provider_rejected",
  "invalid_target",
  "provider_timeout",
  "provider_unreachable",
  "internal_error",
  "unknown",
];

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    payment?: string;
    fulfillment?: string;
    failure_reason?: string;
    target_fix?: string;
    service_id?: string;
    platform_id?: string;
    window?: string;
    cursor?: string;
  }>;
}) {
  const { admin } = await requireAdmin();
  if (!admin) return null;
  const db = createSupabaseAdminClient();
  const params = await searchParams;
  const limit = 25;
  const search = (params.q ?? "").trim();
  const activeFailureReason = params.failure_reason ?? "";
  const activeTargetFix = params.target_fix ?? "";
  const activeServiceId = params.service_id ?? "";
  const activePlatformId = params.platform_id ?? "";
  const activeWindow = params.window ?? "";

  const isFiltered = Boolean(
    search ||
      params.payment ||
      params.fulfillment ||
      activeFailureReason ||
      activeTargetFix ||
      activeServiceId ||
      activePlatformId ||
      activeWindow
  );
  const countStrategy = isFiltered ? "exact" : "planned";

  // Keyset/cursor pagination with strict server-side validation
  let cursorCreatedAt: string | null = null;
  let cursorId: string | null = null;
  if (params.cursor) {
    try {
      const validated = parseOrderCursor(params.cursor);
      if (validated) {
        cursorCreatedAt = validated.createdAt;
        cursorId = validated.id;
      }
    } catch {
      return (
        <div className="admin-orders-page orders-redesign">
          <header className="orders-hero"><h1>Invalid Cursor</h1></header>
          <AdminQueryError message="The pagination cursor is malformed or invalid. Please return to the first page." />
          <Link href="/admin/orders" style={{ marginTop: "1rem", display: "inline-block" }}>← Return to start</Link>
        </div>
      );
    }
  }

  // Query orders. We exclude target_fix_status from the select string so orders load cleanly even if migration 000008 is not present.
  let query = db
    .from("orders")
    .select(
      "id,public_order_id,target_value,quantity,total,currency,payment_status,fulfillment_status,failure_reason,failure_detail,refund_status,refund_amount,created_at,profiles(email),services(name,platforms(name))",
      { count: countStrategy },
    );
  if (params.payment) query = query.eq("payment_status", params.payment);
  if (params.fulfillment) query = query.eq("fulfillment_status", params.fulfillment);
  if (activeFailureReason) query = query.eq("failure_reason", activeFailureReason);
  if (activeTargetFix) query = query.eq("target_fix_status", activeTargetFix);
  if (activeServiceId) query = query.eq("service_id", activeServiceId);
  if (activePlatformId) query = query.eq("services.platform_id", activePlatformId);
  if (activeWindow) {
    const hours = activeWindow === "24h" ? 24 : activeWindow === "30d" ? 720 : 168;
    const windowStart = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    query = query.gte("created_at", windowStart);
  }
  if (search) {
    const escapedSearch = escapePostgrestSearchTerm(search);
    query = query.or(`public_order_id.ilike."%${escapedSearch}%",target_value.ilike."%${escapedSearch}%"`);
  }
  // Keyset filter: rows older than cursor
  if (cursorCreatedAt && cursorId) {
    query = query.or(`created_at.lt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},public_order_id.lt.${cursorId})`);
  }
  const { data: orders, count, error } = await query
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 100));

  if (error) {
    console.error("[AdminOrdersPage] orders query error:", error);
  }

  // Compute bulk refundable orders on current page
  const bulkRefundableOrders = (orders || [])
    .filter((order) => {
      const r = getRefundEligibility({
        id: order.id,
        payment_status: order.payment_status,
        fulfillment_status: order.fulfillment_status,
        failure_reason: order.failure_reason,
        refund_status: (order as { refund_status?: string }).refund_status,
        target_fix_status: (order as { target_fix_status?: string }).target_fix_status,
        total: order.total,
        currency: order.currency,
      });
      return r.eligible && !r.requiresConfirmation;
    })
    .map((order) => ({
      id: order.id,
      publicOrderId: order.public_order_id,
      amount: Number(order.total ?? 0),
      currency: order.currency,
    }));

  // Failure reason summary chips — query counts for all failure reasons in the current window
  // (without the failure_reason filter, so we show counts across the other active filters)
  let failureSummary: Partial<Record<OrderFailureReason, number>> = {};
  if (!error) {
    let summaryQuery = db
      .from("orders")
      .select("failure_reason", { count: "exact" })
      .not("failure_reason", "is", null);
    if (params.payment) summaryQuery = summaryQuery.eq("payment_status", params.payment);
    if (params.fulfillment) summaryQuery = summaryQuery.eq("fulfillment_status", params.fulfillment);
    if (search) {
      const escapedSearch = escapePostgrestSearchTerm(search);
      summaryQuery = summaryQuery.or(`public_order_id.ilike."%${escapedSearch}%",target_value.ilike."%${escapedSearch}%"`);
    }
    const { data: summaryRows } = await summaryQuery;
    if (summaryRows) {
      for (const row of summaryRows) {
        const r = row.failure_reason as OrderFailureReason;
        if (r) failureSummary[r] = (failureSummary[r] ?? 0) + 1;
      }
    }
  }

  const hasSummaryChips = Object.keys(failureSummary).length > 0;

  const currentPaid = (orders ?? []).filter((order) => order.payment_status === "PAID").length;
  const currentActive = (orders ?? []).filter((order) =>
    ["PROCESSING", "SUBMITTING", "SUBMITTED"].includes(order.fulfillment_status),
  ).length;

  // Build next cursor from the last row returned
  const hasNextPage = (orders?.length ?? 0) === limit;
  const lastOrder = orders?.at(-1);
  const nextCursor =
    hasNextPage && lastOrder
      ? Buffer.from(JSON.stringify({ created_at: lastOrder.created_at, id: lastOrder.public_order_id })).toString("base64")
      : null;

  // Count display label
  const countLabel =
    error
      ? "Count unavailable"
      : count === null
        ? "unknown records"
        : isFiltered
          ? `${count} records`
          : `~${count} records`;

  return (
    <div className="admin-orders-page orders-redesign">
      <header className="orders-hero">
        <div>
          <p className="dashboard-kicker">ADMIN / OPERATIONS</p>
          <h1>Orders<span>.</span></h1>
          <p>Track customer purchases, payment state, and fulfillment progress from one clear queue.</p>
        </div>
        <div className="orders-hero-mark" aria-hidden="true">V</div>
      </header>

      <section className="orders-stats">
        <article>
          <span>Total orders</span>
          {error ? <AdminQueryError message="Total unavailable." /> : <strong>{count === null ? "Unavailable" : isFiltered ? count : `~${count}`}</strong>}
          <small>All customer orders matching filters</small>
        </article>
        <article>
          <span>On this page</span>
          {error ? <AdminQueryError message="Page count unavailable." /> : <strong>{orders?.length ?? 0}</strong>}
          <small>Newest activity first</small>
        </article>
        <article>
          <span>Paid</span>
          {error ? <AdminQueryError message="Page count unavailable." /> : <strong>{currentPaid}</strong>}
          <small>Current page</small>
        </article>
        <article>
          <span>In progress</span>
          {error ? <AdminQueryError message="Page count unavailable." /> : <strong>{currentActive}</strong>}
          <small>Current page</small>
        </article>
      </section>

      <section className="admin-orders-panel orders-redesign-panel">
        <div className="customers-panel-heading">
          <div>
            <p className="dashboard-kicker">ORDER QUEUE</p>
            <h2>All orders</h2>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <AdminBulkRefundAction eligibleOrders={bulkRefundableOrders} />
            <AdminBulkRetryAction insufficientFundsCount={failureSummary.provider_insufficient_funds ?? 0} />
            <span>{countLabel}</span>
          </div>
        </div>

        {/* Failure reason summary chips */}
        {hasSummaryChips && (
          <div
            style={{
              display: "flex",
              gap: "8px",
              flexWrap: "wrap",
              padding: "12px 0 4px",
              borderBottom: "1px solid rgba(255,255,255,0.07)",
              marginBottom: "8px",
            }}
          >
            <span style={{ fontSize: "11px", color: "#888", alignSelf: "center", whiteSpace: "nowrap" }}>
              Failure reasons:
            </span>
            {activeFailureReason && (
              <Link
                prefetch={false}
                href={buildOrdersHref(search, params.payment, params.fulfillment, "")}
                style={{ fontSize: "11px", color: "#aaa", alignSelf: "center", textDecoration: "underline" }}
              >
                Clear filter
              </Link>
            )}
            {FAILURE_REASONS.filter((r) => failureSummary[r]).map((r) => (
              <FailureReasonChip
                key={r}
                reason={r}
                count={failureSummary[r]!}
                active={activeFailureReason === r}
                href={buildOrdersHref(
                  search,
                  params.payment,
                  params.fulfillment,
                  activeFailureReason === r ? "" : r,
                )}
              />
            ))}
          </div>
        )}

        <AdminFilterBar
          initialSearch={search}
          searchPlaceholder="Order ID or target"
          selects={[
            {
              name: "payment",
              defaultValue: params.payment ?? "",
              options: [
                { value: "", label: "All payment states" },
                ...["UNPAID", "PENDING", "PAID", "FAILED", "REFUNDED"].map((s) => ({ value: s, label: s })),
              ],
            },
            {
              name: "fulfillment",
              defaultValue: params.fulfillment ?? "",
              options: [
                { value: "", label: "All fulfillment states" },
                ...["NOT_STARTED", "SUBMITTING", "SUBMITTED", "PROCESSING", "COMPLETED", "PARTIAL", "FAILED", "CANCELLED"].map(
                  (s) => ({ value: s, label: s }),
                ),
              ],
            },
            {
              name: "failure_reason",
              defaultValue: activeFailureReason,
              options: [
                { value: "", label: "All failure reasons" },
                ...FAILURE_REASONS.map((r) => ({
                  value: r,
                  label: FAILURE_REASON_BADGE[r].label,
                })),
              ],
            },
            {
              name: "target_fix",
              defaultValue: activeTargetFix,
              options: [
                { value: "", label: "All target fix states" },
                { value: "AWAITING_CUSTOMER", label: "Awaiting customer fix" },
                { value: "FIXED", label: "Target fixed" },
                { value: "EXPIRED", label: "Fix link expired" },
              ],
            },
          ]}
        />

        {error ? (
          <AdminQueryError message="Orders could not be loaded. No empty-order state is being shown." />
        ) : orders?.length ? (
          <div className="dashboard-table-wrap">
            <table className="dashboard-table admin-orders-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Service</th>
                  <th>Target</th>
                  <th>Qty</th>
                  <th>Total</th>
                  <th>Payment</th>
                  <th>Fulfillment</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.public_order_id}>
                    <td>
                      <Link prefetch={false} href={`/admin/orders/${order.public_order_id}`}>
                        {order.public_order_id}
                      </Link>
                      <small>{new Date(order.created_at).toLocaleDateString()}</small>
                    </td>
                    <td>{(order.profiles as { email?: string } | null)?.email ?? "—"}</td>
                    <td>
                      <strong>{(order.services as { name?: string } | null)?.name ?? "—"}</strong>
                      <small>{(order.services as { platforms?: { name?: string } | null } | null)?.platforms?.name ?? "—"}</small>
                    </td>
                    <td>{order.target_value}</td>
                    <td>{order.quantity.toLocaleString()}</td>
                    <td>{order.total} {order.currency}</td>
                    <td>
                      <span className={`admin-status ${order.payment_status.toLowerCase()}`}>
                        {order.payment_status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-start" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span className={`admin-status ${order.fulfillment_status.toLowerCase()}`}>
                            {order.fulfillment_status}
                          </span>
                          <OrderStageIndicator status={order.fulfillment_status} />
                        </div>
                        {order.failure_reason && (
                          <FailureReasonBadge reason={order.failure_reason} />
                        )}
                        {(order as { target_fix_status?: string }).target_fix_status === "AWAITING_CUSTOMER" && (
                          <span
                            style={{
                              display: "inline-block",
                              fontSize: "10px",
                              fontWeight: 700,
                              letterSpacing: "0.04em",
                              padding: "2px 7px",
                              borderRadius: "6px",
                              background: "#3182ce22",
                              color: "#63b3ed",
                              border: "1px solid #3182ce44",
                              marginTop: "2px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            ✉️ Awaiting Customer Fix
                          </span>
                        )}
                        {(order as { target_fix_status?: string }).target_fix_status === "FIXED" && (
                          <span
                            style={{
                              display: "inline-block",
                              fontSize: "10px",
                              fontWeight: 700,
                              letterSpacing: "0.04em",
                              padding: "2px 7px",
                              borderRadius: "6px",
                              background: "#38a16922",
                              color: "#68d391",
                              border: "1px solid #38a16944",
                              marginTop: "2px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            ✓ Target Fixed
                          </span>
                        )}
                        {(() => {
                          const eligibility = getRetryEligibility({
                            id: order.id,
                            payment_status: order.payment_status,
                            fulfillment_status: order.fulfillment_status,
                            failure_reason: order.failure_reason,
                            refund_status: (order as { refund_status?: string }).refund_status,
                          });
                          const refundElig = getRefundEligibility({
                            id: order.id,
                            payment_status: order.payment_status,
                            fulfillment_status: order.fulfillment_status,
                            failure_reason: order.failure_reason,
                            refund_status: (order as { refund_status?: string }).refund_status,
                            target_fix_status: (order as { target_fix_status?: string }).target_fix_status,
                            total: order.total,
                            currency: order.currency,
                          });
                          return (
                            <>
                              {refundElig.canRefund && (
                                <AdminOrderRefundButton
                                  orderId={order.id}
                                  publicOrderId={order.public_order_id}
                                  amount={Number(order.total ?? 0)}
                                  currency={order.currency}
                                  customerEmail={(order.profiles as { email?: string } | null)?.email}
                                  eligible={refundElig.eligible}
                                  requiresConfirmation={refundElig.requiresConfirmation}
                                  canRefund={refundElig.canRefund}
                                  reason={refundElig.reason}
                                  refundStatus={(order as { refund_status?: string }).refund_status}
                                  compact
                                />
                              )}
                              {(eligibility.eligible || eligibility.canForce) && (
                                <AdminOrderRetryAction
                                  orderId={order.id}
                                  publicOrderId={order.public_order_id}
                                  failureReason={order.failure_reason}
                                  canForce={eligibility.canForce}
                                  isEligible={eligibility.eligible}
                                />
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </td>
                    <td>
                      <Link prefetch={false} className="admin-row-action" href={`/admin/orders/${order.public_order_id}`}>
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : count === 0 ? (
          <AdminEmptyState message="No matching orders. Try adjusting the filters or search term." />
        ) : (
          <AdminEmptyState message="No orders are present on this page. Use the previous-page control to return to available results." />
        )}

        {!error && count !== 0 && (
          <nav className="admin-pagination" aria-label="Order pages">
            <div>
              {nextCursor ? (
                <Link
                  aria-label="Next orders page"
                  href={buildOrdersHref(search, params.payment, params.fulfillment, activeFailureReason, nextCursor)}
                >
                  Next →
                </Link>
              ) : (
                <span aria-disabled="true">Next →</span>
              )}
            </div>
          </nav>
        )}
      </section>
    </div>
  );
}
