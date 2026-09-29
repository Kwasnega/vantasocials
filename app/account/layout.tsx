import Link from "next/link";
import { requireUser } from "../../lib/auth/require-user";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser("/account");
  return <main className="dashboard-shell"><aside className="dashboard-sidebar"><Link className="dashboard-brand" href="/">VANTA</Link><p className="dashboard-kicker">ACCOUNT</p><nav><Link href="/account">Overview</Link><Link href="/new-order">New order</Link><Link href="/account/orders">Orders</Link><Link href="/account/wallet">Wallet</Link><Link href="/account/settings">Settings</Link></nav><small>{user.email}</small></aside><section className="dashboard-content">{children}</section></main>;
}
