import { NextResponse } from "next/server";
import { getCurrentUser, createSupabaseAdminClient } from "../../../../../lib/supabase/server";
import { amountToMinorUnits, initializeWalletPaystack } from "../../../../../lib/payments/paystack";
import { clientIp, consumeRateLimits, limiterUnavailable, rateLimited, rulesFor } from "../../../../../lib/security/rate-limit";

const MIN_DEPOSIT_MINOR = 100n;
const MAX_DEPOSIT_MINOR = 1000000n;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try { const rl = await consumeRateLimits(rulesFor("wallet-deposit", user.id, clientIp(request), [3, 10])); if (!rl.allowed) return rateLimited(rl); } catch { return limiterUnavailable(); }
  if (Number(request.headers.get("content-length") || 0) > 4096) return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  const amount = body && typeof body === "object" && typeof (body as Record<string, unknown>).amount === "string" ? (body as Record<string, string>).amount.trim() : "";
  let createdReference: string | null = null;
  try {
    const amountMinor = amountToMinorUnits(amount);
    if (amountMinor < MIN_DEPOSIT_MINOR || amountMinor > MAX_DEPOSIT_MINOR) return NextResponse.json({ error: "Deposit amount must be between GHS 1.00 and GHS 10,000.00." }, { status: 400 });
    const admin = createSupabaseAdminClient();
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || crypto.randomUUID();
    if (!/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)) return NextResponse.json({ error: "Invalid idempotency key." }, { status: 400 });
    const { data: wallet, error: walletError } = await admin.from("wallets").select("id").eq("user_id", user.id).maybeSingle();
    if (walletError) throw walletError;
    let walletId = wallet?.id;
    if (!walletId) {
      const { data: createdWallet, error } = await admin.from("wallets").insert({ user_id: user.id, currency: "GHS" }).select("id").single();
      if (error && error.code !== "23505") throw error;
      walletId = createdWallet?.id;
      if (!walletId) { const retry = await admin.from("wallets").select("id").eq("user_id", user.id).single(); if (retry.error) throw retry.error; walletId = retry.data.id; }
    }
    const { data: existingDeposit } = await admin.from("wallet_deposit_payments").select("id,reference,amount_minor,status,provider_response").eq("user_id", user.id).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (existingDeposit) {
      if (BigInt(existingDeposit.amount_minor) !== amountMinor) return NextResponse.json({ error: "Idempotency key was used for a different amount." }, { status: 409 });
      const response = existingDeposit.provider_response as { authorization_url?: unknown; access_code?: unknown } | null;
      if (existingDeposit.status === "AUTHORIZED" && typeof response?.authorization_url === "string") return NextResponse.json({ authorization_url: response.authorization_url, access_code: typeof response.access_code === "string" ? response.access_code : undefined, reference: existingDeposit.reference });
      if (["INITIALIZING", "PENDING"].includes(existingDeposit.status)) return NextResponse.json({ error: "Deposit initialization is pending reconciliation.", reference: existingDeposit.reference }, { status: 409 });
      if (existingDeposit.status === "PAID") return NextResponse.json({ error: "Deposit is already paid.", reference: existingDeposit.reference }, { status: 409 });
    }
    const reference = `VANTA-WALLET-${crypto.randomUUID().replaceAll("-", "")}`;
    createdReference = reference;
    const { data: deposit, error: depositError } = await admin.from("wallet_deposit_payments").insert({ user_id: user.id, wallet_id: walletId, idempotency_key: idempotencyKey, reference, amount_minor: amountMinor.toString(), currency: "GHS", status: "INITIALIZING", provider: "paystack" }).select("id,reference,amount_minor").single();
    if (depositError?.code === "23505") return NextResponse.json({ error: "Deposit initialization is already in progress. Retry with the same idempotency key.", idempotency_key: idempotencyKey }, { status: 409 });
    if (depositError) throw depositError;
    const origin = process.env.NODE_ENV === "production" ? process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin : new URL(request.url).origin;
    try {
      const initialized = await initializeWalletPaystack({ email: user.email || `${user.id}@invalid.vanta.local`, amountMinor, reference, callbackUrl: `${origin}/account/wallet?deposit_reference=${encodeURIComponent(reference)}`, depositId: deposit.id, userId: user.id });
      const data = initialized.data || {};
      if (typeof data.authorization_url !== "string") throw new Error("Invalid Paystack authorization response.");
      await admin.from("wallet_deposit_payments").update({ status: "AUTHORIZED", provider_response: { authorization_url: data.authorization_url, access_code: typeof data.access_code === "string" ? data.access_code : null } }).eq("id", deposit.id).eq("status", "INITIALIZING");
      return NextResponse.json({ authorization_url: data.authorization_url, access_code: typeof data.access_code === "string" ? data.access_code : undefined, reference });
    } catch (error) {
      await admin.from("wallet_deposit_payments").update({ provider_response: { initialization_ambiguous: true } }).eq("id", deposit.id).eq("status", "INITIALIZING");
      throw error;
    }
  } catch (error) {
    console.error("Wallet deposit initialization failed", error instanceof Error ? error.message : "unknown error");
    if (createdReference) return NextResponse.json({ error: "Deposit initialization is being reconciled. Check status to continue.", reference: createdReference, reconciliation_required: true }, { status: 202 });
    return NextResponse.json({ error: "Unable to initialize wallet deposit." }, { status: 502 });
  }
}
