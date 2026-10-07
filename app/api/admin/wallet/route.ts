import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../lib/supabase/server";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../lib/security/rate-limit";

export async function GET(request: Request) {
  const { user, admin } = await requireAdmin(); if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 }); if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 }); try { const rejected = await enforceAdminRateLimit(request, user.id, "wallet-read", 30); if (rejected) return rejected; } catch { return limiterUnavailable(); }
  const url = new URL(request.url); const page = Math.max(1, Number(url.searchParams.get("page") || "1") || 1); const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || "20") || 20)); const db = createSupabaseAdminClient();
  const { data: wallets, error } = await db.from("wallets").select("id,user_id,currency,balance_minor,created_at,profiles(email)").order("created_at", { ascending: false }).range((page - 1) * limit, page * limit - 1); if (error) return NextResponse.json({ error: "Unable to load wallets." }, { status: 500 });
  const walletRows = wallets ?? [];
  const walletIds = walletRows.map((wallet) => wallet.id);
  const { data: transactions } = walletIds.length ? await db.from("wallet_transactions").select("id,wallet_id,type,direction,status,amount_minor,currency,reference,order_id,created_at").in("wallet_id", walletIds).order("created_at", { ascending: false }).limit(Math.min(500, limit * 10)) : { data: [] };
  const result = walletRows.map((wallet) => {
    const walletTransactions = (transactions ?? []).filter((transaction) => transaction.wallet_id === wallet.id);
    return { ...wallet, balance_minor: String(wallet.balance_minor ?? 0), transactions: walletTransactions.slice(0, 20) };
  });
  return NextResponse.json({ wallets: result, page, limit });
}
