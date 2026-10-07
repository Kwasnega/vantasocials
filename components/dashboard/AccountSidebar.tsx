"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogoutButton } from "../auth/LogoutButton";

const items = [
  { href: "/account", label: "Overview" },
  { href: "/new-order", label: "New order" },
  { href: "/account/orders", label: "Orders" },
  { href: "/account/wallet", label: "Wallet" },
  { href: "/account/settings", label: "Settings" },
];

export function AccountSidebar({ email }: { email: string }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { setCollapsed(window.localStorage.getItem("vanta-sidebar-collapsed") === "true"); }, []);
  function toggleSidebar() { setCollapsed((value) => { const next = !value; window.localStorage.setItem("vanta-sidebar-collapsed", String(next)); return next; }); }
  return <aside className={`dashboard-sidebar${collapsed ? " is-collapsed" : ""}`}>
    <div className="dashboard-sidebar-top"><Link className="dashboard-brand" href="/" aria-label="VANTA home">VANTA</Link><button className="sidebar-toggle" type="button" onClick={toggleSidebar} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed}><span>{collapsed ? "→" : "←"}</span></button></div>
    <p className="dashboard-kicker">ACCOUNT</p>
    <nav aria-label="Account navigation">
      {items.map((item) => {
        const active = item.href === "/account" ? pathname === "/account" : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return <Link className={active ? "active" : undefined} href={item.href} key={item.href} aria-current={active ? "page" : undefined} title={collapsed ? item.label : undefined}><span className="sidebar-item-icon">{item.label.slice(0, 1)}</span><span className="sidebar-item-label">{item.label}</span></Link>;
      })}
    </nav>
    <div className="dashboard-sidebar-footer"><small>{email}</small><LogoutButton /></div>
  </aside>;
}
