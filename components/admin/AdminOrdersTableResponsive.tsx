"use client";

import Link from "next/link";
import { OrderStageIndicator, FailureReasonBadge } from "./OrderBadges";
import { AdminOrderRefundButton } from "./AdminOrderRefundButton";
import { AdminOrderRetryAction } from "./AdminOrderRetryAction";
import { getRetryEligibility } from "../../lib/fulfillment/retry-eligibility";
import { getRefundEligibility } from "../../lib/orders/refund-eligibility";

export type AdminOrderRow = {
  id: string;
  public_order_id: string;
  created_at: string;
  profiles?: { email?: string } | null;
  services?: { name?: string; platforms?: { name?: string; slug?: string } | null } | null;
  service_name_snapshot?: string | null;
  platform_snapshot?: string | null;
  target_value: string;
  quantity: number;
  total: number;
  currency: string;
  payment_status: string;
  fulfillment_status: string;
  failure_reason?: string | null;
  refund_status?: string | null;
  target_fix_status?: string | null;
};

export function AdminOrdersTableResponsive({ orders }: { orders: AdminOrderRow[] }) {
  if (!orders || orders.length === 0) return null;

  return (
    <div className="admin-orders-table-wrapper" style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}>
      {/* Desktop & Tablet Table (Sticky header, fixed layout, no horizontal scroll at 1366px) */}
      <div className="admin-orders-desktop-view" style={{ width: "100%", overflowX: "auto" }}>
        <table
          className="dashboard-table admin-orders-table"
          style={{
            width: "100%",
            tableLayout: "fixed",
            borderCollapse: "collapse",
            fontSize: "12px",
          }}
        >
          <colgroup>
            <col style={{ width: "120px" }} /> {/* Order ID + date */}
            <col style={{ width: "180px" }} /> {/* Customer */}
            <col style={{ width: "230px" }} /> {/* Service */}
            <col style={{ width: "80px" }} />  {/* Qty */}
            <col style={{ width: "110px" }} /> {/* Total */}
            <col style={{ width: "100px" }} /> {/* Payment */}
            <col style={{ width: "150px" }} /> {/* Fulfillment */}
            <col style={{ width: "120px" }} /> {/* Actions */}
          </colgroup>
          <thead style={{ position: "sticky", top: 0, zIndex: 10, backgroundColor: "#170b24" }}>
            <tr>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Order</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Customer</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Service</th>
              <th style={{ padding: "10px 8px", textAlign: "right" }}>Qty</th>
              <th style={{ padding: "10px 8px", textAlign: "right" }}>Amount</th>
              <th style={{ padding: "10px 8px", textAlign: "center" }}>Payment</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Fulfillment</th>
              <th style={{ padding: "10px 8px", textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const customerEmail = order.profiles?.email || "—";
              const sName = order.services?.name || order.service_name_snapshot || "—";
              const pName = order.services?.platforms?.name || order.platform_snapshot || "";
              const isRemoved = !order.services?.name && Boolean(order.service_name_snapshot);

              const eligibility = getRetryEligibility({
                id: order.id,
                payment_status: order.payment_status,
                fulfillment_status: order.fulfillment_status,
                failure_reason: order.failure_reason,
                refund_status: order.refund_status,
              });

              const refundElig = getRefundEligibility({
                id: order.id,
                payment_status: order.payment_status,
                fulfillment_status: order.fulfillment_status,
                failure_reason: order.failure_reason,
                refund_status: order.refund_status,
                target_fix_status: order.target_fix_status,
                total: order.total,
                currency: order.currency,
              });

              return (
                <tr key={order.public_order_id} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  {/* Order ID + Date */}
                  <td style={{ padding: "10px 8px", verticalAlign: "top" }}>
                    <Link
                      prefetch={false}
                      href={`/admin/orders/${order.public_order_id}`}
                      style={{ color: "#d883ff", fontWeight: 700, textDecoration: "none" }}
                    >
                      {order.public_order_id}
                    </Link>
                    <div style={{ fontSize: "11px", color: "#8f8099", marginTop: "2px" }}>
                      {new Date(order.created_at).toLocaleDateString()}
                    </div>
                  </td>

                  {/* Customer Email Truncated with Tooltip */}
                  <td style={{ padding: "10px 8px", verticalAlign: "top" }}>
                    <div
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: "#e8deed",
                      }}
                      title={customerEmail}
                    >
                      {customerEmail}
                    </div>
                  </td>

                  {/* Service Clamped to 2 lines with Platform pill */}
                  <td style={{ padding: "10px 8px", verticalAlign: "top" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      {pName && (
                        <span
                          style={{
                            alignSelf: "flex-start",
                            fontSize: "10px",
                            fontWeight: 600,
                            padding: "1px 6px",
                            borderRadius: "4px",
                            backgroundColor: "rgba(255,255,255,0.08)",
                            color: "#c0b3ca",
                            marginBottom: "2px",
                          }}
                        >
                          {pName}
                        </span>
                      )}
                      <div
                        style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                          lineHeight: 1.3,
                          color: "#fff",
                          fontWeight: 500,
                        }}
                        title={sName}
                      >
                        {sName}
                        {isRemoved && (
                          <span style={{ fontSize: "10px", color: "#f87171", marginLeft: "4px" }}>(removed)</span>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Qty */}
                  <td style={{ padding: "10px 8px", verticalAlign: "top", textAlign: "right" }}>
                    {order.quantity.toLocaleString()}
                  </td>

                  {/* Amount right-aligned */}
                  <td style={{ padding: "10px 8px", verticalAlign: "top", textAlign: "right", whiteSpace: "nowrap" }}>
                    <strong>{order.currency} {Number(order.total).toFixed(2)}</strong>
                  </td>

                  {/* Payment */}
                  <td style={{ padding: "10px 8px", verticalAlign: "top", textAlign: "center" }}>
                    <span
                      style={{
                        display: "inline-block",
                        fontSize: "10px",
                        fontWeight: 700,
                        padding: "2px 6px",
                        borderRadius: "4px",
                        backgroundColor:
                          order.payment_status === "PAID"
                            ? "rgba(16, 185, 129, 0.2)"
                            : "rgba(239, 68, 68, 0.2)",
                        color: order.payment_status === "PAID" ? "#34d399" : "#f87171",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {order.payment_status}
                    </span>
                  </td>

                  {/* Fulfillment */}
                  <td style={{ padding: "10px 8px", verticalAlign: "top" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "3px", alignItems: "flex-start" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span className={`admin-status ${order.fulfillment_status.toLowerCase()}`}>
                          {order.fulfillment_status}
                        </span>
                        <OrderStageIndicator status={order.fulfillment_status} />
                      </div>
                      {order.failure_reason && (
                        <FailureReasonBadge reason={order.failure_reason as any} />
                      )}
                      {order.target_fix_status === "AWAITING_CUSTOMER" && (
                        <span
                          style={{
                            fontSize: "9px",
                            fontWeight: 700,
                            padding: "1px 5px",
                            borderRadius: "4px",
                            backgroundColor: "rgba(99, 179, 237, 0.2)",
                            color: "#63b3ed",
                          }}
                        >
                          Awaiting Fix
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Actions */}
                  <td style={{ padding: "10px 8px", verticalAlign: "top", textAlign: "right" }}>
                    <div style={{ display: "flex", gap: "4px", justifyContent: "flex-end", flexWrap: "wrap" }}>
                      {refundElig.canRefund && (
                        <AdminOrderRefundButton
                          orderId={order.id}
                          publicOrderId={order.public_order_id}
                          amount={Number(order.total ?? 0)}
                          currency={order.currency}
                          customerEmail={order.profiles?.email}
                          eligible={refundElig.eligible}
                          requiresConfirmation={refundElig.requiresConfirmation}
                          canRefund={refundElig.canRefund}
                          reason={refundElig.reason}
                          refundStatus={order.refund_status as any}
                          compact
                        />
                      )}
                      {(eligibility.eligible || eligibility.canForce) && (
                        <AdminOrderRetryAction
                          orderId={order.id}
                          publicOrderId={order.public_order_id}
                          failureReason={order.failure_reason as any}
                          canForce={eligibility.canForce}
                          isEligible={eligibility.eligible}
                        />
                      )}
                      <Link
                        prefetch={false}
                        href={`/admin/orders/${order.public_order_id}`}
                        style={{
                          padding: "3px 8px",
                          borderRadius: "4px",
                          backgroundColor: "rgba(216, 131, 255, 0.12)",
                          color: "#d883ff",
                          textDecoration: "none",
                          fontSize: "11px",
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                        }}
                      >
                        Open →
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Stacked Cards View (< 900px) */}
      <div className="admin-orders-mobile-cards" style={{ display: "none" }}>
        {orders.map((order) => {
          const customerEmail = order.profiles?.email || "—";
          const sName = order.services?.name || order.service_name_snapshot || "—";
          const pName = order.services?.platforms?.name || order.platform_snapshot || "";

          return (
            <div
              key={order.public_order_id}
              style={{
                padding: "14px",
                marginBottom: "12px",
                borderRadius: "12px",
                backgroundColor: "rgba(255, 255, 255, 0.03)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Link
                  prefetch={false}
                  href={`/admin/orders/${order.public_order_id}`}
                  style={{ color: "#d883ff", fontWeight: 700, fontSize: "14px" }}
                >
                  #{order.public_order_id}
                </Link>
                <div style={{ display: "flex", gap: "6px" }}>
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      padding: "2px 6px",
                      borderRadius: "4px",
                      backgroundColor:
                        order.payment_status === "PAID"
                          ? "rgba(16, 185, 129, 0.2)"
                          : "rgba(239, 68, 68, 0.2)",
                      color: order.payment_status === "PAID" ? "#34d399" : "#f87171",
                    }}
                  >
                    {order.payment_status}
                  </span>
                  <span className={`admin-status ${order.fulfillment_status.toLowerCase()}`}>
                    {order.fulfillment_status}
                  </span>
                </div>
              </div>

              <div>
                {pName && (
                  <span style={{ fontSize: "10px", color: "#c0b3ca", fontWeight: 600 }}>
                    {pName} ·{" "}
                  </span>
                )}
                <span style={{ color: "#fff", fontSize: "13px", fontWeight: 500 }}>
                  {sName}
                </span>
                <div style={{ fontSize: "11px", color: "#8f8099", marginTop: "2px" }}>
                  {customerEmail}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "8px" }}>
                <div>
                  <span style={{ fontSize: "11px", color: "#8f8099" }}>Qty: {order.quantity.toLocaleString()} · </span>
                  <strong style={{ fontSize: "13px", color: "#34d399" }}>{order.currency} {Number(order.total).toFixed(2)}</strong>
                </div>
                <Link
                  prefetch={false}
                  href={`/admin/orders/${order.public_order_id}`}
                  style={{
                    padding: "4px 10px",
                    borderRadius: "6px",
                    backgroundColor: "#d883ff",
                    color: "#190b26",
                    fontSize: "12px",
                    fontWeight: 700,
                    textDecoration: "none",
                  }}
                >
                  View Details →
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
