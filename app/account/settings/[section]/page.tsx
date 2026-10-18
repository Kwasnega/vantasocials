import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteAccountButton } from "../../../../components/account/DeleteAccountButton";
import { PasswordChangeForm } from "../../../../components/account/PasswordChangeForm";
import { requireUser } from "../../../../lib/auth/require-user";

const sections: Record<string, { label: string; title: string; description: string }> = {
  profile: { label: "PROFILE", title: "Your profile", description: "Your account identity and contact details." },
  security: { label: "SECURITY", title: "Change your password", description: "Verify your current password before setting a new one." },
  danger: { label: "DANGER ZONE", title: "Delete your account", description: "Deleting your VANTA account permanently disables sign-in and removes your profile details. Order, payment, and wallet transaction records are retained for accounting and support. Any remaining wallet balance or pending deposit must be resolved before deletion." },
};

export default async function SettingsSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { user } = await requireUser("/account/settings");
  const section = sections[(await params).section];
  if (!section) notFound();
  return (
    <div className="settings-detail-page">
      <Link className="settings-detail-back" href="/account/settings">← Back to settings</Link>
      <p className="dashboard-kicker">{section.label}</p>
      <h1>{section.title}</h1>
      <p className="settings-detail-description">{section.description}</p>
      <section className="settings-detail-card">
        {section.label !== "SECURITY" && (
          <span className="settings-icon">{section.label === "DANGER ZONE" ? "!" : "◈"}</span>
        )}
        {section.label === "PROFILE" && (
          <>
            <h2>{user.email}</h2>
            <p>Name and phone editing will be enabled when those fields are supported by the customer profile model.</p>
          </>
        )}
        {section.label === "SECURITY" && (
          <PasswordChangeForm />
        )}
        {section.label === "DANGER ZONE" && (
          <>
            <h2>Delete account permanently</h2>
            <p>Your sign-in will be disabled and profile email anonymized. Financial and order records will remain in VANTA’s records. Resolve any wallet balance or pending deposit before proceeding.</p>
            <DeleteAccountButton />
          </>
        )}
      </section>
    </div>
  );
}
