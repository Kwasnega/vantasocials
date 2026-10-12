import Link from "next/link";

export default function NotFound() {
  return (
    <main className="checkout-shell">
      <div className="checkout-container">
        <div className="checkout-empty-state">
          <div className="checkout-empty-icon" aria-hidden="true">404</div>
          <p className="checkout-kicker">PAGE NOT FOUND</p>
          <h1>Lost in Orbit</h1>
          <p className="checkout-empty-desc">
            The page you are looking for doesn’t exist or has been moved.
          </p>
          <div className="checkout-empty-actions">
            <Link href="/" className="checkout-btn checkout-btn-primary">
              Return Home
            </Link>
            <Link href="/account" className="checkout-btn checkout-btn-outline">
              Go to Dashboard
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
