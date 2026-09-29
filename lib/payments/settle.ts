import "server-only";

import { createSupabaseAdminClient } from "../supabase/server";
import { verifyPaystack, amountToMinorUnits } from "./paystack";

export async function verifyAndSettlePaystack(reference: string, expectedUserId?: string) {
  const admin = createSupabaseAdminClient();
  const { data: payment, error } = await admin.from("payments").select("id,order_id,user_id,reference,amount,currency,status").eq("provider", "paystack").eq("reference", reference).maybeSingle();
  if (error) throw error;
  if (!payment || (expectedUserId && payment.user_id !== expectedUserId)) return { found: false, paid: false };
  const { data: order, error: orderError } = await admin.from("orders").select("id,total,currency,status,payment_status").eq("id", payment.order_id).eq("user_id", payment.user_id).maybeSingle();
  if (orderError) throw orderError;
  if (!order) return { found: false, paid: false };
  const response = await verifyPaystack(reference);
  const transaction = response.data || {};
  const matches = transaction.status === "success" && transaction.reference === reference && String(transaction.currency || "") === String(order.currency) && String(transaction.amount || "") === amountToMinorUnits(String(order.total)).toString() && String(payment.currency) === String(order.currency) && amountToMinorUnits(String(payment.amount)) === amountToMinorUnits(String(order.total));
  if (!matches) return { found: true, paid: false };
  const transactionId = transaction.id == null ? null : String(transaction.id);
  const { data: settled, error: settlementError } = await admin.rpc("settle_paystack_order_payment", {
    p_payment_id: payment.id,
    p_expected_user_id: payment.user_id,
    p_verified_reference: reference,
    p_verified_amount_minor: amountToMinorUnits(String(order.total)).toString(),
    p_verified_currency: String(order.currency),
    p_transaction_id: transactionId,
    p_provider_response: { verified: true },
  });
  if (settlementError) throw settlementError;
  const result = Array.isArray(settled) ? settled[0] : settled;
  return { found: true, paid: Boolean(result?.settled) };
}
