import { requireAdmin } from "../../../lib/admin/auth";

export default async function AdminSettingsPage() { await requireAdmin(); return <><header className="dashboard-header"><p className="dashboard-kicker">ADMIN</p><h1>Settings.</h1><p>No editable operational settings are available in this phase.</p></header></> }
