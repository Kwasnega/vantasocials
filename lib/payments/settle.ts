import "server-only";

import { createSupabaseAdminClient } from "../supabase/server";
import { verifyPaystack, amountToMinorUnits } from "./paystack";

export async function verifyAndSettlePaystack(reference: string, expectedUserId?: string) {
  const admin = createSupabaseAdminClient();
  const { data: payment, error } = await admin.from("payments").select("id,order_id,user_id,reference,amount,currency,status").eq("provider", "paystack").eq("reference", reference).maybeSingle();
  if (error) throw error;
  if (!payment || (expectedUserId && payment.user_id !== expectedUserId)) return { found: false, paid: false };
  const { data: order, error: orderError } = await admin.from("orders").select("id,total,currency,status,payment_status").eq("id", payment.order_id).maybeSingle();
  if (orderError) throw orderError;
  if (!order) return { found: false, paid: false };
  const response = await verifyPaystack(reference);
  const transaction = response.data || {};
  const matches = transaction.status === "success" && transaction.reference === reference && String(transaction.currency || "") === String(order.currency) && String(transaction.amount || "") === amountToMinorUnits(String(order.total)).toString() && String(payment.currency) === String(order.currency) && amountToMinorUnits(String(payment.amount)) === amountToMinorUnits(String(order.total));
  if (!matches) return { found: true, paid: false };
  if (payment.status === "PAID" && order.payment_status === "PAID") return { found: true, paid: true };
  const { error: paymentError } = await admin.from("payments").update({ status: "PAID", paid_at: new Date().toISOString(), provider_response: { verified: true, transaction_id: transaction.id ?? null } }).eq("id", payment.id).eq("status", "PENDING");
  if (paymentError) throw paymentError;
  const { error: orderUpdateError } = await admin.from("orders").update({ payment_status: "PAID" }).eq("id", order.id).eq("status", "PENDING_PAYMENT").eq("payment_status", "UNPAID");
  if (orderUpdateError) throw orderUpdateError;
  return { found: true, paid: true };
}
