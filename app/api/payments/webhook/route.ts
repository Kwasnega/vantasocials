import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabase/server";
import { verifyAndSettlePaystack } from "../../../../lib/payments/settle";
import { verifyPaystack } from "../../../../lib/payments/paystack";

export async function POST(request: Request) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return NextResponse.json({ error: "Webhook unavailable." }, { status: 503 });
  const rawBody = await request.text();
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
  try {
    const admin = createSupabaseAdminClient();
    const { data: existing, error: existingError } = await admin.from("webhook_events").select("id,processed").eq("provider", "paystack").eq("event_id", eventId).maybeSingle();
    if (existingError) throw existingError;
    if (existing?.processed) return NextResponse.json({ received: true });
    if (!existing) {
      const { error: insertError } = await admin.from("webhook_events").insert({ provider: "paystack", event_id: eventId, event_type: typeof payload.event === "string" ? payload.event : "unknown", payload });
      if (insertError && insertError.code !== "23505") throw insertError;
    }
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
    await admin.from("webhook_events").update({ processed: true, processed_at: new Date().toISOString() }).eq("provider", "paystack").eq("event_id", eventId);
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Paystack webhook processing failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
