"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LogoutButton } from "../auth/LogoutButton";

const items = [
  { href: "/account", label: "Overview", icon: "overview" },
  { href: "/new-order", label: "New order", icon: "new-order" },
  { href: "/account/orders", label: "Orders", icon: "orders" },
  { href: "/account/wallet", label: "Wallet", icon: "wallet" },
  { href: "/account/settings", label: "Settings", icon: "settings" },
];

export function AccountSidebar({ email }: { email: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const prefetchedRoutes = useRef(new Set<string>());
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { setCollapsed(window.localStorage.getItem("vanta-sidebar-collapsed") === "true"); }, []);
  function toggleSidebar() { setCollapsed((value) => { const next = !value; window.localStorage.setItem("vanta-sidebar-collapsed", String(next)); return next; }); }
  function prefetchRoute(href: string) {
    if (pathname === href || prefetchedRoutes.current.has(href)) return;
    prefetchedRoutes.current.add(href);
    router.prefetch(href);
  }
  return <aside className={`dashboard-sidebar account-sidebar${collapsed ? " is-collapsed" : ""}`}>
    <div className="dashboard-sidebar-top"><Link className="dashboard-brand" href="/" aria-label="VANTA home">VANTA</Link><button className="sidebar-toggle" type="button" onClick={toggleSidebar} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed}><span>{collapsed ? "→" : "←"}</span></button></div>
    <p className="dashboard-kicker">ACCOUNT</p>
    <nav className="account-navigation" aria-label="Account navigation">
      {items.map((item) => {
        const active = item.href === "/account" ? pathname === "/account" : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return <Link
          className={active ? "active" : undefined}
          href={item.href}
          key={item.href}
          onMouseEnter={() => prefetchRoute(item.href)}
          onTouchStart={() => prefetchRoute(item.href)}
          onFocus={() => prefetchRoute(item.href)}
          aria-current={active ? "page" : undefined}
          title={collapsed ? item.label : undefined}
          aria-label={item.label}
        >
          <span className="sidebar-item-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              {item.icon === "overview" && <><path d="M3.5 10.5 12 3.5l8.5 7" /><path d="M5.5 9.5v10h13v-10M9.5 19.5v-6h5v6" /></>}
              {item.icon === "new-order" && <><circle cx="12" cy="12" r="8.5" /><path d="M12 8v8M8 12h8" /></>}
              {item.icon === "orders" && <><path d="M7 4.5h10a2 2 0 0 1 2 2v13H5v-13a2 2 0 0 1 2-2Z" /><path d="M9 3.5v3M15 3.5v3M8.5 11h7M8.5 15h7" /></>}
              {item.icon === "wallet" && <><rect x="3.5" y="5.5" width="17" height="14" rx="2.5" /><path d="M3.5 9h17M15.5 14h2" /></>}
              {item.icon === "settings" && <><path d="m10 3.8.5-1h3l.5 1 1.5 1 .9-.2 2.1 2.1-.2.9 1 1.5 1 .5v3l-1 .5-1 1.5.2.9-2.1 2.1-.9-.2-1.5 1-.5 1h-3l-.5-1-1.5-1-.9.2-2.1-2.1.2-.9-1-1.5-1-.5v-3l1-.5 1-1.5-.2-.9 2.1-2.1.9.2 1.5-1Z" /><circle cx="12" cy="11.5" r="3" /></>}
            </svg>
          </span>
          <span className="sidebar-item-label">{item.label}</span>
        </Link>;
      })}
    </nav>
    <div className="dashboard-sidebar-footer"><small>{email}</small><LogoutButton /></div>
  </aside>;
}
