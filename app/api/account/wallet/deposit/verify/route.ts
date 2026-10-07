import { NextResponse } from "next/server";
import { getCurrentUser, createSupabaseAdminClient } from "../../../../../../lib/supabase/server";
import { verifyPaystack } from "../../../../../../lib/payments/paystack";
import { clientIp, consumeRateLimits, limiterUnavailable, rateLimited, rulesFor } from "../../../../../../lib/security/rate-limit";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try { const rl = await consumeRateLimits(rulesFor("wallet-deposit-verify", user.id, clientIp(request), [10, 30])); if (!rl.allowed) return rateLimited(rl); } catch { return limiterUnavailable(); }
  if (Number(request.headers.get("content-length") || 0) > 4096) return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  const reference = body && typeof body === "object" && typeof (body as Record<string, unknown>).reference === "string" ? (body as Record<string, string>).reference.trim() : "";
  if (!reference) return NextResponse.json({ error: "reference is required." }, { status: 400 });
  try {
    const admin = createSupabaseAdminClient();
    const { data: deposit, error } = await admin.from("wallet_deposit_payments").select("id,user_id,amount_minor,currency,provider_reference,status").eq("reference", reference).maybeSingle();
    if (error) throw error;
    if (!deposit || deposit.user_id !== user.id) return NextResponse.json({ error: "Deposit not found." }, { status: 404 });
    if (deposit.status === "PAID" && deposit.provider_reference) return NextResponse.json({ status: "PAID", reference });
    const verified = await verifyPaystack(reference);
    const tx = verified.data || {};
    const providerReference = String(tx.reference || "");
    const amount = String(tx.amount || "");
    const currency = String(tx.currency || "");
    if (tx.status !== "success") return NextResponse.json({ status: "PENDING", reference });
    if (providerReference !== reference || amount !== String(deposit.amount_minor) || currency !== "GHS") return NextResponse.json({ status: "FAILED", reference }, { status: 400 });
    const { data: credited, error: creditError } = await admin.rpc("credit_wallet_deposit", { p_deposit_id: deposit.id, p_user_id: user.id, p_provider_reference: providerReference, p_amount_minor: BigInt(deposit.amount_minor).toString(), p_currency: "GHS" });
    if (creditError) throw creditError;
    return NextResponse.json({ status: "PAID", reference, transaction_id: credited?.id ?? null });
  } catch (error) {
    const details = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error;
    console.error("Wallet deposit verification failed", JSON.stringify(details));
    return NextResponse.json({ error: "Unable to verify wallet deposit." }, { status: 502 });
  }
}
