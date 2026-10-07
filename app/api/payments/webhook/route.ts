import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabase/server";
import { verifyAndSettlePaystack } from "../../../../lib/payments/settle";
import { verifyPaystack } from "../../../../lib/payments/paystack";

export async function POST(request: Request) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return NextResponse.json({ error: "Webhook unavailable." }, { status: 503 });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 65536) return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > 65536) return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  const signature = request.headers.get("x-paystack-signature") || "";
  const expected = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
  if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  let event: unknown;
  try { event = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "Invalid payload." }, { status: 400 }); }
  if (!event || typeof event !== "object") return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  const payload = event as { event?: unknown; data?: { id?: unknown; reference?: unknown } };
  const reference = typeof payload.data?.reference === "string" ? payload.data.reference : "";
  const eventId = payload.data?.id != null ? `${String(payload.event || "event")}:${String(payload.data.id)}` : "";
  if (!eventId || !reference) return NextResponse.json({ received: true });
  let processingToken: string | null = null;
  try {
    const admin = createSupabaseAdminClient();
    const { data: claimRows, error: claimError } = await admin.rpc("claim_paystack_webhook_event", { p_event_id: eventId, p_event_type: typeof payload.event === "string" ? payload.event : "unknown", p_payload: payload });
    if (claimError) throw claimError;
    const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
    if (!claim?.claimed) return NextResponse.json({ received: true });
    processingToken = typeof claim.processing_token === "string" ? claim.processing_token : null;
    if (!processingToken) return NextResponse.json({ received: true });
    const { data: byReference } = await admin.from("wallet_deposit_payments").select("id,user_id,amount_minor,currency,status").eq("reference", reference).maybeSingle();
    const { data: byProviderReference } = byReference ? { data: null } : await admin.from("wallet_deposit_payments").select("id,user_id,amount_minor,currency,status").eq("provider_reference", reference).maybeSingle();
    const deposit = byReference || byProviderReference;
    if (deposit) {
        const verified = await verifyPaystack(reference);
        const tx = verified.data || {};
        if (tx.status === "success" && String(tx.reference || "") === reference && String(tx.amount || "") === String(deposit.amount_minor) && String(tx.currency || "") === "GHS") {
          const { error: creditError } = await admin.rpc("credit_wallet_deposit", { p_deposit_id: deposit.id, p_user_id: deposit.user_id, p_provider_reference: reference, p_amount_minor: String(deposit.amount_minor), p_currency: "GHS" });
          if (creditError) throw creditError;
        }
    } else {
      await verifyAndSettlePaystack(reference);
    }
    const { error: completeError } = await admin.rpc("complete_paystack_webhook_event", { p_event_id: eventId, p_processing_token: processingToken });
    if (completeError) throw completeError;
    return NextResponse.json({ received: true });
  } catch (error) {
    const details = error instanceof Error ? error.message : "unknown";
    console.error("Paystack webhook processing failed", details);
    if (typeof processingToken === "string") await createSupabaseAdminClient().rpc("fail_paystack_webhook_event", { p_event_id: eventId, p_processing_token: processingToken, p_error: details });
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
