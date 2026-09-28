import { LogoutButton } from "../../../components/auth/LogoutButton";
import { requireUser } from "../../../lib/auth/require-user";

export default async function AccountSettingsPage() { const { user } = await requireUser("/account/settings"); return <><header className="dashboard-header"><p className="dashboard-kicker">SETTINGS</p><h1>Your account.</h1></header><div className="dashboard-card"><p>Authenticated email</p><strong>{user.email}</strong><div className="dashboard-actions"><LogoutButton /></div></div></> }
