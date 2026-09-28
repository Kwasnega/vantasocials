import "server-only";

import { createSupabaseAdminClient, getCurrentUser } from "../supabase/server";

export type CheckoutOrder = {
  public_order_id: string;
  service_name: string;
  platform: string;
  target_type: string;
  target_value: string;
  quantity: number;
  unit_price: string;
  subtotal: string;
  total: string;
  currency: string;
  status: string;
  payment_status: string;
};

export async function getCheckoutOrder(publicOrderId: string): Promise<CheckoutOrder | null> {
  const user = await getCurrentUser();
  if (!user || !publicOrderId.trim()) return null;

  const admin = createSupabaseAdminClient();
  const { data: order, error } = await admin
    .from("orders")
    .select("public_order_id,service_id,target_type,target_value,quantity,unit_price,subtotal,total,currency,status,payment_status,user_id")
    .eq("public_order_id", publicOrderId.trim())
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!order) return null;

  const { data: service, error: serviceError } = await admin
    .from("services")
    .select("name,platform_id")
    .eq("id", order.service_id)
    .maybeSingle();
  if (serviceError) throw serviceError;
  if (!service) return null;

  const { data: platform, error: platformError } = await admin
    .from("platforms")
    .select("name")
    .eq("id", service.platform_id)
    .maybeSingle();
  if (platformError) throw platformError;
  if (!platform) return null;

  return {
    public_order_id: order.public_order_id,
    service_name: service.name,
    platform: platform.name,
    target_type: order.target_type,
    target_value: order.target_value,
    quantity: order.quantity,
    unit_price: order.unit_price,
    subtotal: order.subtotal,
    total: order.total,
    currency: order.currency,
    status: order.status,
    payment_status: order.payment_status,
  };
}
