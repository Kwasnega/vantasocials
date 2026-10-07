"use client";

import Link from "next/link";

export function SettingsCards({ email }: { email: string }) {
  const cards = [
    { id: "profile", label: "Profile", icon: "♙", title: email, text: "Name and phone editing will be enabled when those fields are supported by the customer profile model." },
    { id: "security", label: "Security", icon: "▢", title: "Password and sessions", text: "Use the authenticated sign-out control below. Password reset remains handled by the existing auth flow.", action: true },
    { id: "preferences", label: "Preferences", icon: "☷", title: "Not configured", text: "Notification preferences are not yet represented in the current data model." },
    { id: "danger", label: "Danger zone", icon: "!", title: "Account closure", text: "Closure requests are intentionally unavailable until a safeguarded review workflow exists." },
  ];
  return <div className="settings-grid">{cards.map((card) => <Link className={`dashboard-card settings-card${card.id === "danger" ? " danger-card" : ""}`} href={`/account/settings/${card.id}`} key={card.id}><span className="settings-card-trigger"><span className="settings-icon">{card.icon}</span><span>{card.label}</span><b>↗</b></span><span className="settings-card-details"><strong>{card.title}</strong><small>{card.text}</small></span></Link>)}</div>;
}
