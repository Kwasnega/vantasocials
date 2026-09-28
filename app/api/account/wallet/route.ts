import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/auth/require-user";

export async function GET(request: Request) {
  const { user, db } = await requireUser("/account/wallet");
  const url = new URL(request.url); const page = Math.max(1, Number(url.searchParams.get("page") || "1") || 1); const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || "20") || 20));
  const { data: wallet, error: walletError } = await db.from("wallets").select("id,currency,created_at").eq("user_id", user.id).maybeSingle();
  if (walletError) return NextResponse.json({ error: "Unable to load wallet." }, { status: 500 });
  if (!wallet) return NextResponse.json({ wallet: null, balance_minor: "0", transactions: [] });
  const { data: transactions, error } = await db.from("wallet_transactions").select("id,type,direction,status,amount_minor,currency,reference,order_id,created_at").eq("wallet_id", wallet.id).order("created_at", { ascending: false }).range((page - 1) * limit, page * limit - 1);
  if (error) return NextResponse.json({ error: "Unable to load wallet transactions." }, { status: 500 });
  const { data: projectedWallet, error: balanceError } = await db.from("wallets").select("balance_minor").eq("id", wallet.id).single();
  if (balanceError) return NextResponse.json({ error: "Unable to load wallet balance." }, { status: 500 });
  return NextResponse.json({ wallet, balance_minor: String(projectedWallet?.balance_minor ?? 0), transactions: transactions ?? [], page, limit });
}
