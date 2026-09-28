import "server-only";

const PAYSTACK_API = "https://api.paystack.co";

export function getPaystackSecret() {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) throw new Error("Paystack is not configured.");
  return secret;
}

export function amountToMinorUnits(value: string) {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error("Invalid currency amount.");
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

async function paystackFetch(path: string, init: RequestInit) {
  const response = await fetch(`${PAYSTACK_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${getPaystackSecret()}`, "Content-Type": "application/json", ...(init.headers || {}) },
    cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body !== "object" || !(body as { status?: boolean }).status) throw new Error("Paystack request failed.");
  return body as { status: true; data?: Record<string, unknown> };
}

export function initializePaystack(input: { email: string; amount: string; currency: string; reference: string; callbackUrl: string; orderId: string }) {
  return paystackFetch("/transaction/initialize", { method: "POST", body: JSON.stringify({ email: input.email, amount: amountToMinorUnits(input.amount).toString(), currency: input.currency, reference: input.reference, callback_url: input.callbackUrl, metadata: JSON.stringify({ vanta_order_id: input.orderId }) }) });
}

export function initializeWalletPaystack(input: { email: string; amountMinor: bigint; reference: string; callbackUrl: string; depositId: string; userId: string }) {
  return paystackFetch("/transaction/initialize", { method: "POST", body: JSON.stringify({ email: input.email, amount: input.amountMinor.toString(), currency: "GHS", reference: input.reference, callback_url: input.callbackUrl, metadata: JSON.stringify({ vanta_wallet_deposit_id: input.depositId, vanta_user_id: input.userId }) }) });
}

export function verifyPaystack(reference: string) {
  return paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`, { method: "GET" });
}
