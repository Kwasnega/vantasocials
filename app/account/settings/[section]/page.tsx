import Link from "next/link";
import { notFound } from "next/navigation";
import { LogoutButton } from "../../../../components/auth/LogoutButton";
import { requireUser } from "../../../../lib/auth/require-user";

const sections: Record<string, { label: string; title: string; description: string }> = {
  profile: { label: "PROFILE", title: "Your profile", description: "Your account identity and contact details." },
  security: { label: "SECURITY", title: "Password and sessions", description: "Manage the authenticated session currently active in VANTA." },
  preferences: { label: "PREFERENCES", title: "Your preferences", description: "Notification preferences will become available here as the account model expands." },
  danger: { label: "DANGER ZONE", title: "Account closure", description: "Closure requests are intentionally unavailable until a safeguarded review workflow exists." },
};

export default async function SettingsSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { user } = await requireUser("/account/settings");
  const section = sections[(await params).section];
  if (!section) notFound();
  return <div className="settings-detail-page"><Link className="settings-detail-back" href="/account/settings">← Back to settings</Link><p className="dashboard-kicker">{section.label}</p><h1>{section.title}</h1><p className="settings-detail-description">{section.description}</p><section className="settings-detail-card"><span className="settings-icon">{section.label === "DANGER ZONE" ? "!" : "◈"}</span>{section.label === "PROFILE" && <><h2>{user.email}</h2><p>Name and phone editing will be enabled when those fields are supported by the customer profile model.</p></>}{section.label === "SECURITY" && <><h2>Active session</h2><p>You are signed in as {user.email}.</p><LogoutButton /></>}{section.label === "PREFERENCES" && <><h2>Not configured</h2><p>Notification preferences are not yet represented in the current data model.</p></>}{section.label === "DANGER ZONE" && <><h2>Account closure</h2><p>Closure requests are intentionally unavailable until a safeguarded review workflow exists.</p></>}</section></div>;
}
