import { requireUser } from "../../../lib/auth/require-user";
import { SettingsCards } from "../../../components/account/SettingsCards";

export default async function AccountSettingsPage() { const { user } = await requireUser("/account/settings"); return <><header className="dashboard-header settings-header"><p className="dashboard-kicker">SETTINGS</p><h1>Your account.</h1><p>Manage the account controls currently supported by VANTA.</p></header><SettingsCards email={user.email ?? ""} /></> }
