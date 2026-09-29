import Link from "next/link";
import { requireUser } from "../../../lib/auth/require-user";
import WalletDepositForm from "../../../components/wallet/WalletDepositForm";
import WalletDepositStatus from "../../../components/wallet/WalletDepositStatus";

export default async function AccountWalletPage({ searchParams }: { searchParams: Promise<{ deposit_reference?: string; type?: string; page?: string }> }) {
  const { user, db } = await requireUser("/account/wallet");
  const params = await searchParams; const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1); const limit = 20; const type = params.type ?? "ALL";
  const { data: wallet } = await db.from("wallets").select("id,currency,balance_minor").eq("user_id", user.id).maybeSingle();
  let balanceMinor = 0n;
  let transactions: Array<{ id: string; type: string; direction: string; status: string; amount_minor: string; reference: string; order_id: string | null; created_at: string }> = [];
  if (wallet) {
    balanceMinor = BigInt(wallet.balance_minor ?? 0);
    let txQuery = db.from("wallet_transactions").select("id,type,direction,status,amount_minor,reference,order_id,created_at", { count: "exact" }).eq("wallet_id", wallet.id);
    if (["DEPOSIT", "ORDER_DEBIT", "REFUND", "MANUAL_ADJUSTMENT"].includes(type)) txQuery = txQuery.eq("type", type);
    const result = await txQuery.order("created_at", { ascending: false }).range((page - 1) * limit, page * limit - 1);
    transactions = (result.data ?? []) as typeof transactions;
  }
  return <><WalletDepositStatus reference={params.deposit_reference} /><header className="dashboard-header"><p className="dashboard-kicker">WALLET</p><h1>Your wallet.</h1><p>Deposit GHS securely through Paystack.</p></header><div className="dashboard-grid"><article className="dashboard-card"><span>Current balance</span><strong>{(Number(balanceMinor) / 100).toFixed(2)} {wallet?.currency ?? "GHS"}</strong><small>Balance from the wallet projection.</small></article><WalletDepositForm /><article className="dashboard-card"><span>Funding</span><strong>Paystack</strong><small>Deposits are verified server-side before crediting.</small></article></div><div className="dashboard-card"><div className="dashboard-card-heading"><h2>Transactions</h2><form><select name="type" defaultValue={type}><option value="ALL">All</option><option value="DEPOSIT">Deposits</option><option value="ORDER_DEBIT">Order payments</option><option value="REFUND">Refunds</option><option value="MANUAL_ADJUSTMENT">Adjustments</option></select><button type="submit">Filter</button></form></div>{transactions.length === 0 ? <p>No wallet transactions yet.</p> : <ul className="dashboard-list">{transactions.map((entry) => <li key={entry.id}><span>{entry.type} · {entry.reference}{entry.order_id ? ` · ${entry.order_id}` : ""}</span><span>{entry.direction === "CREDIT" ? "+" : "−"}{(Number(entry.amount_minor) / 100).toFixed(2)} GHS · {entry.status}</span></li>)}</ul>}<div className="dashboard-actions">{page > 1 && <Link href={`/account/wallet?type=${type}&page=${page - 1}`}>Previous</Link>}{transactions.length === limit && <Link href={`/account/wallet?type=${type}&page=${page + 1}`}>Next</Link>}</div></div></>;
}
