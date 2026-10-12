import { requireAdmin } from "../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../lib/supabase/server";
import { AdminEmptyState, AdminQueryError } from "../AdminDataState";

export default async function AdminWalletPage() {
  const { admin } = await requireAdmin();
  if (!admin) return null;
  const db = createSupabaseAdminClient();
  const [
    { data: wallets, count: walletCount, error: walletsError },
    { data: deposits, count: depositCount, error: depositsError },
    { data: transactions, count: transactionCount, error: transactionsError },
  ] = await Promise.all([
    db.from("wallets").select("id,user_id,balance_minor,currency,created_at,profiles(email)", { count: "exact" }).order("created_at", { ascending: false }).limit(100),
    db.from("wallet_deposit_payments").select("user_id,amount_minor,status,reference,created_at,paid_at", { count: "exact" }).order("created_at", { ascending: false }).limit(100),
    db.from("wallet_transactions").select("wallet_id,type,direction,status,amount_minor,reference,order_id,created_at", { count: "exact" }).order("created_at", { ascending: false }).limit(100),
  ]);
  const sampledBalances = (wallets ?? []).reduce<Record<string, number>>((totals, wallet) => {
    const currency = String(wallet.currency ?? "UNKNOWN");
    totals[currency] = (totals[currency] ?? 0) + Number(wallet.balance_minor ?? 0);
    return totals;
  }, {});

  return <>
    <header className="dashboard-header">
      <p className="dashboard-kicker">FINANCE</p>
      <h1>Wallet operations.</h1>
      <p>Read-only wallet and ledger samples. Displayed sums are limited to the rows shown and are not total wallet liability.</p>
    </header>
    <div className="dashboard-grid">
      <article className="dashboard-card">
        <span>Wallet balance sample (latest 100)</span>
        {walletsError ? <AdminQueryError message="Wallet balances could not be loaded." /> : <>
          <strong>{Object.entries(sampledBalances).map(([currency, minor]) => `${(minor / 100).toFixed(2)} ${currency}`).join(" · ") || "0.00"}</strong>
          <small>{wallets?.length ?? 0} of {walletCount ?? "unknown"} wallets; sample only, not global liability</small>
        </>}
      </article>
      <article className="dashboard-card">
        <span>Deposits (latest 100)</span>
        {depositsError ? <AdminQueryError message="Deposit records could not be loaded." /> : <>
          <strong>{deposits?.length ?? 0}</strong>
          <small>Showing up to 100 of {depositCount ?? "unknown"} records</small>
        </>}
      </article>
      <article className="dashboard-card">
        <span>Ledger entries (latest 100)</span>
        {transactionsError ? <AdminQueryError message="Wallet ledger could not be loaded." /> : <>
          <strong>{transactions?.length ?? 0}</strong>
          <small>Showing up to 100 of {transactionCount ?? "unknown"} records</small>
        </>}
      </article>
    </div>
    <div className="dashboard-card">
      <h2>Wallets (latest 100)</h2>
      {walletsError ? <AdminQueryError message="Wallet records could not be loaded." /> : wallets?.length ? (
        <table className="dashboard-table"><thead><tr><th>Customer</th><th>Balance</th><th>Created</th></tr></thead><tbody>
          {wallets.map((wallet) => <tr key={wallet.id}>
            <td>{(wallet.profiles as { email?: string } | null)?.email ?? wallet.user_id}</td>
            <td>{(Number(wallet.balance_minor ?? 0) / 100).toFixed(2)} {wallet.currency}</td>
            <td>{new Date(wallet.created_at).toLocaleDateString()}</td>
          </tr>)}
        </tbody></table>
      ) : <AdminEmptyState message="No wallet records found." />}
    </div>
    <div className="dashboard-card">
      <h2>Recent ledger (latest 100)</h2>
      {transactionsError ? <AdminQueryError message="Wallet ledger could not be loaded." /> : transactions?.length ? (
        <table className="dashboard-table"><thead><tr><th>Type</th><th>Direction</th><th>Amount</th><th>Reference</th><th>Order</th></tr></thead><tbody>
          {transactions.slice(0, 50).map((transaction, index) => <tr key={`${transaction.reference}-${index}`}>
            <td>{transaction.type}</td><td>{transaction.direction}</td><td>{(Number(transaction.amount_minor) / 100).toFixed(2)} GHS</td>
            <td>{transaction.reference}</td><td>{transaction.order_id ?? "—"}</td>
          </tr>)}
        </tbody></table>
      ) : <AdminEmptyState message="No wallet ledger entries found." />}
    </div>
    <div className="dashboard-card">
      <h2>Recent deposits (latest 100)</h2>
      {depositsError ? <AdminQueryError message="Deposit records could not be loaded." /> : deposits?.length ? (
        <table className="dashboard-table"><thead><tr><th>Customer</th><th>Reference</th><th>Amount</th><th>Status</th><th>Created</th></tr></thead><tbody>
          {deposits.slice(0, 50).map((deposit, index) => <tr key={`${deposit.reference}-${index}`}>
            <td>{deposit.user_id}</td><td>{deposit.reference}</td><td>{(Number(deposit.amount_minor) / 100).toFixed(2)} GHS</td>
            <td>{deposit.status}</td><td>{new Date(deposit.created_at).toLocaleString()}</td>
          </tr>)}
        </tbody></table>
      ) : <AdminEmptyState message="No deposit records found." />}
    </div>
  </>;
}
