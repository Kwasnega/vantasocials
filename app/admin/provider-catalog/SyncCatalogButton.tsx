export function SyncCatalogButton() {
  return <form className="dashboard-actions" action="/api/admin/providers/reliablesmm/sync" method="post"><button type="submit">Sync ReliableSMM catalog</button></form>;
}
