import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "../../../../lib/admin/auth";

export default async function AdminOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { admin } = await requireAdmin();
  if (!admin) return null;
  const { id } = await params;
  const db = (await import("../../../../lib/supabase/server")).createSupabaseAdminClient();
  const { data: order } = await db.from("orders").select("id,public_order_id,user_id,target_type,target_value,quantity,unit_price,subtotal,total,currency,status,payment_status,fulfillment_status,created_at,updated_at,profiles(email,display_name),services(name,slug,platforms(name))").eq("public_order_id", id).maybeSingle();
  if (!order) notFound();
  const [{ data: payments }, { data: walletEntries }, { data: providerOrders }] = await Promise.all([
    db.from("payments").select("provider,reference,amount,currency,status,paid_at,provider_response,created_at").eq("order_id", order.id).order("created_at", { ascending: false }).limit(10),
    db.from("wallet_transactions").select("type,direction,status,amount_minor,reference,created_at").eq("order_id", order.id).limit(10),
    db.from("provider_orders").select("provider,provider_order_id,provider_service_id,status,attempt_status,error_code,created_at,updated_at").eq("order_id", order.id).limit(10),
  ]);
  const safeWalletEntries = walletEntries ?? [];
  const profile = order.profiles as { email?: string; display_name?: string | null } | null;
  const service = order.services as { name?: string; slug?: string; platforms?: { name?: string } | null } | null;
  return <><header className="dashboard-header"><p className="dashboard-kicker">ORDER OPERATIONS</p><h1>{order.public_order_id}</h1><p>{profile?.email ?? order.user_id} · {service?.platforms?.name ?? "—"} / {service?.name ?? "—"}</p></header><div className="dashboard-grid">{[["Target", order.target_value],["Quantity", order.quantity],["Unit price", `${order.unit_price} ${order.currency}`],["Total", `${order.total} ${order.currency}`],["Payment", order.payment_status],["Fulfillment", order.fulfillment_status],["Created", new Date(order.created_at).toLocaleString()],["Updated", new Date(order.updated_at).toLocaleString()]].map(([label,value]) => <article className="dashboard-card" key={String(label)}><span>{label}</span><strong>{value}</strong></article>)}</div><div className="dashboard-card"><h2>Payments</h2><table className="dashboard-table"><thead><tr><th>Provider</th><th>Reference</th><th>Amount</th><th>Status</th><th>Paid</th></tr></thead><tbody>{(payments ?? []).map((payment) => <tr key={payment.reference}><td>{payment.provider}</td><td>{payment.reference}</td><td>{payment.amount} {payment.currency}</td><td>{payment.status}</td><td>{payment.paid_at ? new Date(payment.paid_at).toLocaleString() : "—"}</td></tr>)}</tbody></table></div><div className="dashboard-card"><h2>Fulfillment visibility</h2><p>Provider submission remains disabled in this phase.</p><table className="dashboard-table"><thead><tr><th>Provider</th><th>Provider order</th><th>Attempt</th><th>Status</th><th>Error</th></tr></thead><tbody>{(providerOrders ?? []).map((item, index) => <tr key={`${item.provider}-${index}`}><td>{item.provider}</td><td>{item.provider_order_id ?? "—"}</td><td>{item.attempt_status ?? "—"}</td><td>{item.status}</td><td>{item.error_code ?? "—"}</td></tr>)}</tbody></table></div><div className="dashboard-card"><h2>Wallet ledger</h2>{safeWalletEntries.length === 0 ? <p>No wallet debit/refund entries.</p> : <table className="dashboard-table"><thead><tr><th>Type</th><th>Direction</th><th>Amount</th><th>Reference</th></tr></thead><tbody>{safeWalletEntries.map((entry) => <tr key={entry.reference}><td>{entry.type}</td><td>{entry.direction}</td><td>{(Number(entry.amount_minor) / 100).toFixed(2)} GHS</td><td>{entry.reference}</td></tr>)}</tbody></table>}</div><Link href="/admin/orders">Back to orders</Link></>;
}
