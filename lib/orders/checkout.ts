import "server-only";

import { createSupabaseAdminClient, getCurrentUser } from "../supabase/server";

export type CheckoutOrder = {
  public_order_id: string;
  service_name: string;
  service_slug?: string;
  category?: string;
  platform: string;
  platform_slug?: string;
  target_type: string;
  target_value: string;
  quantity: number;
  unit_price: string;
  subtotal: string;
  total: string;
  currency: string;
  status: string;
  payment_status: string;
  fulfillment_status?: string;
  wallet_balance_minor: string;
  input_values?: Record<string, unknown> | null;
  created_at?: string;
  user_email?: string | null;
};

export async function getCheckoutOrder(publicOrderId: string): Promise<CheckoutOrder | null> {
  const user = await getCurrentUser();
  if (!user || !publicOrderId.trim()) return null;

  const admin = createSupabaseAdminClient();
  const { data: order, error } = await admin
    .from("orders")
    .select("public_order_id,service_id,target_type,target_value,quantity,unit_price,subtotal,total,currency,status,payment_status,fulfillment_status,created_at,user_id,input_values")
    .eq("public_order_id", publicOrderId.trim())
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!order) return null;

  const { data: service, error: serviceError } = await admin
    .from("services")
    .select("name,slug,category,platform_id")
    .eq("id", order.service_id)
    .maybeSingle();
  if (serviceError) throw serviceError;
  if (!service) return null;

  const [platformResult, walletResult] = await Promise.all([
    admin
      .from("platforms")
      .select("name,slug")
      .eq("id", service.platform_id)
      .maybeSingle(),
    admin
      .from("wallets")
      .select("balance_minor")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  const { data: platform, error: platformError } = platformResult;
  if (platformError) throw platformError;
  if (!platform) return null;
  const { data: wallet, error: walletError } = walletResult;
  if (walletError) throw walletError;

  return {
    public_order_id: order.public_order_id,
    service_name: service.name,
    service_slug: service.slug,
    category: service.category,
    platform: platform.name,
    platform_slug: platform.slug,
    target_type: order.target_type,
    target_value: order.target_value,
    quantity: order.quantity,
    unit_price: order.unit_price,
    subtotal: order.subtotal,
    total: order.total,
    currency: order.currency,
    status: order.status,
    payment_status: order.payment_status,
    fulfillment_status: order.fulfillment_status,
    wallet_balance_minor: String(wallet?.balance_minor ?? 0),
    input_values: order.input_values,
    created_at: order.created_at,
    user_email: user.email,
  };
}
