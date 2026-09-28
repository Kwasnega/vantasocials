import "server-only";

// The persisted VANTA order UUID is the stable business key. A future write
// adapter must send this value (plus provider/service scope) as its idempotency
// key and persist the provider response under the same order before retrying.
// No provider request is made by this helper.
export function panelFollowsIdempotencyKey(orderId: string, providerServiceId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(orderId) || !/^\d+$/.test(providerServiceId)) throw new Error("Invalid fulfillment idempotency inputs.");
  return `vanta:${orderId}:panelfollows:${providerServiceId}`;
}
