import "server-only";
import { createSupabaseAdminClient } from "../supabase/server";

export async function claimOrder(orderId: string, ownerToken: string) {
  const { data, error } = await createSupabaseAdminClient().rpc("claim_fulfillment_order", { p_order_id: orderId, p_owner_token: ownerToken, p_lease_seconds: 600 });
  if (error) throw error;
  return data === true;
}

export async function renewOrderClaim(orderId: string, ownerToken: string) {
  const { data, error } = await createSupabaseAdminClient().rpc("renew_fulfillment_order_claim", { p_order_id: orderId, p_owner_token: ownerToken, p_lease_seconds: 600 });
  if (error) throw error;
  return data === true;
}

export async function releaseOrderClaim(orderId: string, ownerToken: string) {
  const { error } = await createSupabaseAdminClient().rpc("release_fulfillment_order_claim", { p_order_id: orderId, p_owner_token: ownerToken });
  if (error) throw error;
}
