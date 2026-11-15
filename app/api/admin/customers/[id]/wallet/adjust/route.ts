import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../../../lib/supabase/server";
import { consumeRateLimits, rulesFor, clientIp, rateLimited, limiterUnavailable } from "../../../../../../../lib/security/rate-limit";
import { sendTransactionalEmail, renderWalletCreditEmail } from "../../../../../../../lib/email";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { admin } = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: customerId } = await params;
  if (!customerId) {
    return NextResponse.json({ error: "Customer ID is required" }, { status: 400 });
  }

  // Rate limiting
  try {
    const rl = await consumeRateLimits(rulesFor("admin-wallet-adjust", admin.id, clientIp(request), [20, 60]));
    if (!rl.allowed) return rateLimited(rl);
  } catch {
    return limiterUnavailable();
  }

  try {
    const body = await request.json();
    const rawAmount = Number(body.amount);
    const reasonCategory = typeof body.category === "string" ? body.category : "other";
    const internalNote = typeof body.note === "string" ? body.note.trim() : "";
    const linkedOrderId = typeof body.order_id === "string" && body.order_id.trim() ? body.order_id.trim() : null;
    const idempotencyKey = typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : "";

    if (!rawAmount || isNaN(rawAmount) || rawAmount <= 0) {
      return NextResponse.json({ error: "Amount must be a positive number." }, { status: 400 });
    }

    if (!internalNote) {
      return NextResponse.json({ error: "A short note explaining the adjustment is required." }, { status: 400 });
    }

    if (!idempotencyKey || idempotencyKey.length < 8) {
      return NextResponse.json({ error: "A valid idempotency key is required." }, { status: 400 });
    }

    const amountMinor = BigInt(Math.round(rawAmount * 100));

    const db = createSupabaseAdminClient();

    // Verify customer exists and get email
    const { data: customer, error: custErr } = await db
      .from("profiles")
      .select("id,email")
      .eq("id", customerId)
      .maybeSingle();

    if (custErr || !customer) {
      return NextResponse.json({ error: "Customer not found." }, { status: 404 });
    }

    // Call atomic SQL function
    const { data: rpcData, error: rpcErr } = await db.rpc("credit_customer_wallet_manual", {
      p_customer_id: customerId,
      p_admin_id: admin.id,
      p_amount_minor: amountMinor.toString(),
      p_idempotency_key: idempotencyKey,
      p_reason_category: reasonCategory,
      p_internal_note: internalNote,
      p_linked_order_id: linkedOrderId,
    });

    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message }, { status: 400 });
    }

    const res = Array.isArray(rpcData) ? rpcData[0] : rpcData;

    if (!res || !res.success) {
      return NextResponse.json({ error: res?.error_message || "Adjustment failed." }, { status: 400 });
    }

    // Write audit log
    await db.from("admin_action_log").insert({
      action: "MANUAL_WALLET_CREDIT",
      performed_by: admin.id,
      performed_at: new Date().toISOString(),
      details: {
        customer_id: customerId,
        customer_email: customer.email,
        amount_ghs: rawAmount,
        amount_minor: Number(amountMinor),
        category: reasonCategory,
        internal_note: internalNote,
        linked_order_id: linkedOrderId,
        idempotency_key: idempotencyKey,
        already_credited: res.already_credited,
      },
    });

    // Send customer notification email non-blocking (only if newly credited)
    if (customer.email && !res.already_credited) {
      const emailContent = renderWalletCreditEmail({ amountGhs: rawAmount });
      sendTransactionalEmail({
        to: customer.email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      }).catch((e) => console.warn("[ManualWalletAdjust] Failed to send email:", e));
    }

    return NextResponse.json({
      success: true,
      already_credited: res.already_credited,
      transaction_id: res.transaction_id,
      amount_ghs: rawAmount,
      new_balance_ghs: Number(res.new_balance_minor || 0) / 100,
    });
  } catch (err) {
    console.error("[API] Manual wallet adjust error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
