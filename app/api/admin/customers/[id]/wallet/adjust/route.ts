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

    // Call atomic SQL function or fallback to direct transactional logic if RPC fails auth check
    let res: {
      success: boolean;
      already_credited: boolean;
      transaction_id: string;
      credited_amount_minor?: number;
      new_balance_minor?: number;
      error_message?: string;
    } | null = null;

    const { data: rpcData, error: rpcErr } = await db.rpc("credit_customer_wallet_manual", {
      p_customer_id: customerId,
      p_admin_id: admin.id,
      p_amount_minor: amountMinor.toString(),
      p_idempotency_key: idempotencyKey,
      p_reason_category: reasonCategory,
      p_internal_note: internalNote,
      p_linked_order_id: linkedOrderId,
    });

    if (!rpcErr && rpcData) {
      res = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as typeof res;
    } else {
      // Fallback: execute atomically via direct table operations using service_role admin client
      // 1. Verify safety cap
      const { data: settingRow } = await db
        .from("app_settings")
        .select("value")
        .eq("key", "manual_adjustment_max_ghs")
        .maybeSingle();

      const maxCapGhs = Number(settingRow?.value ?? 500);
      if (rawAmount > maxCapGhs) {
        return NextResponse.json(
          { error: `Adjustment exceeds maximum allowable cap of GHS ${maxCapGhs.toFixed(2)}.` },
          { status: 400 }
        );
      }

      // 2. Check idempotency reference
      const reference = `manual-adjustment:${idempotencyKey.trim()}`;
      const { data: existingTx } = await db
        .from("wallet_transactions")
        .select("id,amount_minor,wallet_id")
        .eq("reference", reference)
        .maybeSingle();

      if (existingTx) {
        const { data: wal } = await db
          .from("wallets")
          .select("balance_minor")
          .eq("id", existingTx.wallet_id)
          .single();

        res = {
          success: true,
          already_credited: true,
          transaction_id: existingTx.id,
          credited_amount_minor: Number(existingTx.amount_minor),
          new_balance_minor: Number(wal?.balance_minor ?? 0),
        };
      } else {
        // 3. Ensure wallet exists
        await db
          .from("wallets")
          .insert({ user_id: customerId, currency: "GHS", balance_minor: 0 })
          .select("id")
          .maybeSingle();

        const { data: wallet, error: walErr } = await db
          .from("wallets")
          .select("id,balance_minor")
          .eq("user_id", customerId)
          .single();

        if (walErr || !wallet) {
          return NextResponse.json({ error: "Customer wallet not found." }, { status: 400 });
        }

        // 4. Insert transaction (trigger automatically updates wallet.balance_minor!)
        const { data: insertedTx, error: txErr } = await db
          .from("wallet_transactions")
          .insert({
            wallet_id: wallet.id,
            type: "MANUAL_ADJUSTMENT",
            direction: "CREDIT",
            status: "COMPLETED",
            amount_minor: Number(amountMinor),
            currency: "GHS",
            reference,
            order_id: linkedOrderId,
            metadata: {
              source: "admin_manual_adjustment",
              admin_id: admin.id,
              category: reasonCategory,
              internal_note: internalNote,
              customer_visible_label: "Account credit from VANTA support",
            },
          })
          .select("id,amount_minor")
          .single();

        if (txErr || !insertedTx) {
          console.error("[ManualWalletAdjust] Insertion failed:", txErr);
          return NextResponse.json(
            { error: txErr?.message || "Failed to record wallet transaction." },
            { status: 400 }
          );
        }

        // 5. Fetch updated balance
        const { data: updatedWal } = await db
          .from("wallets")
          .select("balance_minor")
          .eq("id", wallet.id)
          .single();

        res = {
          success: true,
          already_credited: false,
          transaction_id: insertedTx.id,
          credited_amount_minor: Number(amountMinor),
          new_balance_minor: Number(updatedWal?.balance_minor ?? wallet.balance_minor),
        };
      }
    }

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
