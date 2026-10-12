import Link from "next/link";
import type { ReactNode } from "react";

const legalLinks = [
  { href: "/refund-policy", label: "Refund policy" },
  { href: "/terms", label: "Terms of service" },
  { href: "/privacy-policy", label: "Privacy policy" },
  { href: "/contact", label: "Contact" },
];

export function LegalPage({
  title,
  kicker,
  children,
}: {
  title: string;
  kicker: string;
  children: ReactNode;
}) {
  return (
    <main className="service-page legal-page">
      <Link href="/" aria-label="VANTA home">VANTA</Link>
      <article className="legal-content">
        <p className="section-kicker">{kicker}</p>
        <h1>{title}</h1>
        <p className="legal-updated">Last updated: 12 October 2026</p>
        <div className="legal-prose">{children}</div>
        <nav className="legal-nav" aria-label="Legal and support pages">
          {legalLinks.map((item) => <Link href={item.href} key={item.href}>{item.label}</Link>)}
        </nav>
      </article>
    </main>
  );
}
