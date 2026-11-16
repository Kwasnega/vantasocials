import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../../../lib/supabase/server";
import { consumeRateLimits, rulesFor, clientIp, rateLimited, limiterUnavailable } from "../../../../../../../lib/security/rate-limit";

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

  try {
    const rl = await consumeRateLimits(rulesFor("admin-wallet-adjust", admin.id, clientIp(request), [20, 60]));
    if (!rl.allowed) return rateLimited(rl);
  } catch {
    return limiterUnavailable();
  }

  try {
    const body = await request.json();
    const targetBalanceGhs = Number(body.target_balance);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    if (isNaN(targetBalanceGhs) || targetBalanceGhs < 0) {
      return NextResponse.json({ error: "Target balance must be a non-negative number." }, { status: 400 });
    }

    if (!reason) {
      return NextResponse.json({ error: "A note explaining the balance edit is required." }, { status: 400 });
    }

    const db = createSupabaseAdminClient();

    // Ensure wallet exists
    await db
      .from("wallets")
      .insert({ user_id: customerId, currency: "GHS", balance_minor: 0 })
      .select("id")
      .maybeSingle();

    const { data: wallet, error: walErr } = await db
      .from("wallets")
      .select("id, balance_minor, currency")
      .eq("user_id", customerId)
      .single();

    if (walErr || !wallet) {
      return NextResponse.json({ error: "Customer wallet not found." }, { status: 404 });
    }

    const currentBalanceMinor = Number(wallet.balance_minor ?? 0);
    const targetBalanceMinor = Math.round(targetBalanceGhs * 100);
    const diffMinor = targetBalanceMinor - currentBalanceMinor;

    if (diffMinor === 0) {
      return NextResponse.json({
        success: true,
        message: "Wallet is already at the target balance.",
        current_balance: currentBalanceMinor / 100,
        new_balance: targetBalanceMinor / 100,
      });
    }

    const direction = diffMinor > 0 ? "CREDIT" : "DEBIT";
    const amountMinor = Math.abs(diffMinor);
    const reference = `manual-edit-balance:${Date.now()}:${Math.random().toString(36).substring(2, 8)}`;

    const { data: insertedTx, error: txErr } = await db
      .from("wallet_transactions")
      .insert({
        wallet_id: wallet.id,
        type: "MANUAL_ADJUSTMENT",
        direction,
        status: "COMPLETED",
        amount_minor: amountMinor,
        currency: wallet.currency || "GHS",
        reference,
        metadata: {
          source: "admin_edit_balance",
          admin_id: admin.id,
          reason,
          previous_balance_ghs: currentBalanceMinor / 100,
          target_balance_ghs: targetBalanceGhs,
          diff_ghs: diffMinor / 100,
        },
      })
      .select("id")
      .single();

    if (txErr) {
      console.error("[Edit Balance Error]:", txErr);
      return NextResponse.json({ error: `Failed to adjust balance: ${txErr.message}` }, { status: 500 });
    }

    // Read the newly recalculated balance
    const { data: updatedWallet } = await db
      .from("wallets")
      .select("balance_minor")
      .eq("id", wallet.id)
      .single();

    // Log to admin_action_log
    await db.from("admin_action_log").insert({
      action: "EDIT_CUSTOMER_BALANCE",
      performed_by: admin.id,
      details: {
        customer_id: customerId,
        previous_balance: currentBalanceMinor / 100,
        new_balance: Number(updatedWallet?.balance_minor ?? targetBalanceMinor) / 100,
        diff_ghs: diffMinor / 100,
        direction,
        reason,
        transaction_id: insertedTx.id,
      },
      result_summary: {
        success: true,
        new_balance: Number(updatedWallet?.balance_minor ?? targetBalanceMinor) / 100,
      },
    });

    return NextResponse.json({
      success: true,
      transaction_id: insertedTx.id,
      previous_balance: currentBalanceMinor / 100,
      new_balance: Number(updatedWallet?.balance_minor ?? targetBalanceMinor) / 100,
    });
  } catch (err) {
    console.error("[Edit Balance Exception]:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
