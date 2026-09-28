import { requireAdmin } from "../../../lib/admin/auth";

export default async function AdminWalletPage() { await requireAdmin(); return <><header className="dashboard-header"><p className="dashboard-kicker">FINANCE</p><h1>Wallet.</h1><p>Wallet ledger and adjustments are reserved for a future phase.</p></header><div className="dashboard-grid">{["Deposits","Transactions","Refunds","Manual adjustments"].map((item) => <article className="dashboard-card" key={item}><strong>{item}</strong><small>Not implemented yet.</small></article>)}</div></> }
