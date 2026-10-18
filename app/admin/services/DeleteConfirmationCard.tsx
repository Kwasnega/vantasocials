"use client";

export function DeleteConfirmationCard({
  title,
  description,
  warning,
  confirmLabel,
  busyLabel,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  warning: string;
  confirmLabel: string;
  busyLabel: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <section className="admin-delete-confirmation" aria-label={title}>
      <div>
        <p className="dashboard-kicker">CONFIRM DELETION</p>
        <h3>{title}</h3>
        <p>{description}</p>
        <p className="admin-delete-warning">{warning}</p>
        {error && <p className="admin-delete-error" role="alert">{error}</p>}
      </div>
      <div className="admin-delete-confirmation-actions">
        <button type="button" className="admin-delete-cancel" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="admin-delete-confirm" onClick={onConfirm} disabled={busy}>
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </section>
  );
}
