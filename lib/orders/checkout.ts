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
  const walletPromise = admin
    .from("wallets")
    .select("balance_minor")
    .eq("user_id", user.id)
    .maybeSingle();
  const { data: order, error } = await admin
    .from("orders")
    .select("public_order_id,target_type,target_value,quantity,unit_price,subtotal,total,currency,status,payment_status,fulfillment_status,created_at,user_id,input_values,services(name,slug,category,platforms(name,slug))")
    .eq("public_order_id", publicOrderId.trim())
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!order) return null;

  const service = Array.isArray(order.services) ? order.services[0] : order.services;
  if (!service) return null;
  const platform = Array.isArray(service.platforms) ? service.platforms[0] : service.platforms;
  if (!platform) return null;

  const { data: wallet, error: walletError } = await walletPromise;
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
