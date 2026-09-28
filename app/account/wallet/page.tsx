import { requireUser } from "../../../lib/auth/require-user";
import WalletDepositForm from "../../../components/wallet/WalletDepositForm";
import WalletDepositStatus from "../../../components/wallet/WalletDepositStatus";

export default async function AccountWalletPage({ searchParams }: { searchParams: Promise<{ deposit_reference?: string }> }) {
  const { user, db } = await requireUser("/account/wallet");
  const params = await searchParams;
  const { data: wallet } = await db.from("wallets").select("id,currency,balance_minor").eq("user_id", user.id).maybeSingle();
  let balanceMinor = 0n;
  let transactions: Array<{ id: string; type: string; direction: string; amount_minor: string; reference: string; created_at: string }> = [];
  if (wallet) {
    balanceMinor = BigInt(wallet.balance_minor ?? 0);
    const result = await db.from("wallet_transactions").select("id,type,direction,amount_minor,reference,created_at").eq("wallet_id", wallet.id).order("created_at", { ascending: false }).limit(20);
    transactions = (result.data ?? []) as typeof transactions;
  }
  return <><WalletDepositStatus reference={params.deposit_reference} /><header className="dashboard-header"><p className="dashboard-kicker">WALLET</p><h1>Your wallet.</h1><p>Deposit GHS securely through Paystack.</p></header><div className="dashboard-grid"><article className="dashboard-card"><span>Current balance</span><strong>{(Number(balanceMinor) / 100).toFixed(2)} {wallet?.currency ?? "GHS"}</strong><small>Balance from the wallet projection.</small></article><WalletDepositForm /><article className="dashboard-card"><span>Funding</span><strong>Paystack</strong><small>Deposits are verified server-side before crediting.</small></article></div><div className="dashboard-card"><h2>Transactions</h2>{transactions.length === 0 ? <p>No wallet transactions yet.</p> : <ul className="dashboard-list">{transactions.map((entry) => <li key={entry.id}><span>{entry.type} · {entry.reference}</span><span>{entry.direction === "CREDIT" ? "+" : "−"}{(Number(entry.amount_minor) / 100).toFixed(2)} GHS</span></li>)}</ul>}</div></>;
}
