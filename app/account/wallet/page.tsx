import Link from "next/link";
import { requireUser } from "../../../lib/auth/require-user";
import WalletDepositForm from "../../../components/wallet/WalletDepositForm";
import WalletDepositStatus from "../../../components/wallet/WalletDepositStatus";

function formatTransactionReference(reference: string, orderId: string | null) {
  if (orderId) return `Order ${orderId.slice(0, 8).toUpperCase()}`;
  const value = reference.replace(/^wallet-deposit:/i, "");
  return `Reference ${value.length > 14 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value}`;
}

export default async function AccountWalletPage({ searchParams }: { searchParams: Promise<{ deposit_reference?: string; type?: string; page?: string }> }) {
  const { user, db } = await requireUser("/account/wallet");
  const params = await searchParams; const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1); const limit = 20; const type = params.type ?? "ALL";
  const { data: wallet, error: walletError } = await db.from("wallets").select("id,currency,balance_minor").eq("user_id", user.id).maybeSingle();
  if (walletError) throw walletError;
  let balanceMinor = 0n;
  let transactions: Array<{ id: string; type: string; direction: string; status: string; amount_minor: string; reference: string; order_id: string | null; created_at: string }> = [];
  if (wallet) {
    balanceMinor = BigInt(wallet.balance_minor ?? 0);
    let txQuery = db.from("wallet_transactions").select("id,type,direction,status,amount_minor,reference,order_id,created_at").eq("wallet_id", wallet.id);
    if (["DEPOSIT", "ORDER_DEBIT", "REFUND", "MANUAL_ADJUSTMENT"].includes(type)) txQuery = txQuery.eq("type", type);
    const result = await txQuery.order("created_at", { ascending: false }).range((page - 1) * limit, page * limit - 1);
    if (result.error) throw result.error;
    transactions = (result.data ?? []) as typeof transactions;
  }
  return <><WalletDepositStatus reference={params.deposit_reference} /><header className="dashboard-header wallet-header"><p className="dashboard-kicker">WALLET</p><h1>Your wallet<span>.</span></h1><p>Deposit GHS securely through Paystack.</p></header><div className="wallet-grid"><article className="dashboard-card wallet-balance-card"><div className="wallet-card-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M4 6.5h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2Z" /><path d="M2 9V6a2 2 0 0 1 2-2h12" /><path d="M15.5 12.5h4.5v3h-4.5a1.5 1.5 0 0 1 0-3Z" /></svg></div><span>Current balance</span><strong>{(Number(balanceMinor) / 100).toFixed(2)} <small>{wallet?.currency ?? "GHS"}</small></strong><small>Ready to use on your next order.</small><span className="wallet-balance-note"><span aria-hidden="true" /> Available to spend</span></article><WalletDepositForm /></div><section className="wallet-transactions"><div className="dashboard-card-heading"><div><p className="dashboard-kicker">WALLET ACTIVITY</p><h2>Transactions</h2></div><form><select name="type" defaultValue={type}><option value="ALL">All</option><option value="DEPOSIT">Deposits</option><option value="ORDER_DEBIT">Order payments</option><option value="REFUND">Refunds</option><option value="MANUAL_ADJUSTMENT">Adjustments</option></select><button type="submit">Filter</button></form></div>{transactions.length === 0 ? <div className="wallet-empty"><div className="empty-icon">V</div><p>No wallet transactions yet.</p></div> : <ul className="dashboard-list wallet-list">{transactions.map((entry) => <li key={entry.id}><span><b>{entry.type.replaceAll("_", " ")}</b><small title={entry.reference}>{formatTransactionReference(entry.reference, entry.order_id)}</small></span><span className={entry.direction === "CREDIT" ? "wallet-credit" : "wallet-debit"}>{entry.direction === "CREDIT" ? "+" : "−"}{(Number(entry.amount_minor) / 100).toFixed(2)} GHS<small>{entry.status}</small></span></li>)}</ul>}<div className="dashboard-actions">{page > 1 && <Link href={`/account/wallet?type=${type}&page=${page - 1}`}>Previous</Link>}{transactions.length === limit && <Link href={`/account/wallet?type=${type}&page=${page + 1}`}>Next</Link>}</div></section></>;
}
