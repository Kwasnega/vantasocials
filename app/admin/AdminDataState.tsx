export function AdminQueryError({ message = "This data could not be loaded. Please try again." }: { message?: string }) {
  return <p className="dashboard-card" role="alert" style={{ borderColor: "#6b2639", color: "#ffb3be" }}>{message}</p>;
}

export function AdminEmptyState({ message }: { message: string }) {
  return <p className="dashboard-card">{message}</p>;
}
