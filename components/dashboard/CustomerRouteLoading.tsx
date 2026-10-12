export type CustomerLoadingVariant =
  | "dashboard"
  | "overview"
  | "orders"
  | "order-detail"
  | "wallet"
  | "settings"
  | "setting-detail"
  | "catalog"
  | "service"
  | "checkout";

const labels: Record<CustomerLoadingVariant, string> = {
  dashboard: "account",
  overview: "account overview",
  orders: "order history",
  "order-detail": "order details",
  wallet: "wallet activity",
  settings: "account settings",
  "setting-detail": "account setting",
  catalog: "service catalog",
  service: "service details",
  checkout: "checkout",
};

function Placeholder({ className = "" }: { className?: string }) {
  return <span className={`customer-loading-placeholder ${className}`} />;
}

function PlaceholderRows({ count = 4 }: { count?: number }) {
  return (
    <div className="customer-loading-rows">
      {Array.from({ length: count }, (_, index) => (
        <div className="customer-loading-row" key={index}>
          <Placeholder className="customer-loading-row-main" />
          <Placeholder className="customer-loading-row-side" />
        </div>
      ))}
    </div>
  );
}

export function CustomerRouteLoading({ variant }: { variant: CustomerLoadingVariant }) {
  return (
    <section
      className={`customer-route-loading customer-route-loading-${variant}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={`Loading ${labels[variant]}`}
    >
      <span className="customer-loading-screen-reader">Loading {labels[variant]}…</span>
      <div className="customer-loading-content" aria-hidden="true">
        <header className="customer-loading-heading">
          <Placeholder className="customer-loading-eyebrow" />
          <Placeholder className="customer-loading-title" />
          <Placeholder className="customer-loading-description" />
        </header>

        {variant === "dashboard" && (
          <div className="customer-loading-panel">
            <Placeholder className="customer-loading-section-title" />
            <PlaceholderRows count={5} />
          </div>
        )}

        {variant === "overview" && (
          <>
            <div className="customer-loading-metrics">
              {Array.from({ length: 5 }, (_, index) => (
                <div className="customer-loading-card" key={index}>
                  <Placeholder className="customer-loading-label" />
                  <Placeholder className="customer-loading-value" />
                  <Placeholder className="customer-loading-caption" />
                </div>
              ))}
            </div>
            <div className="customer-loading-panel">
              <Placeholder className="customer-loading-section-title" />
              <PlaceholderRows count={3} />
            </div>
          </>
        )}

        {variant === "orders" && (
          <>
            <div className="customer-loading-filters">
              <Placeholder />
              <Placeholder />
              <Placeholder />
              <Placeholder />
            </div>
            <div className="customer-loading-panel">
              <Placeholder className="customer-loading-section-title" />
              <PlaceholderRows count={7} />
            </div>
          </>
        )}

        {variant === "order-detail" && (
          <>
            <div className="customer-loading-panel customer-loading-details">
              {Array.from({ length: 8 }, (_, index) => (
                <div key={index}>
                  <Placeholder className="customer-loading-label" />
                  <Placeholder className="customer-loading-value" />
                </div>
              ))}
            </div>
            <div className="customer-loading-panel">
              <Placeholder className="customer-loading-section-title" />
              <PlaceholderRows count={3} />
            </div>
          </>
        )}

        {variant === "wallet" && (
          <>
            <div className="customer-loading-metrics customer-loading-wallet-cards">
              {Array.from({ length: 3 }, (_, index) => (
                <div className="customer-loading-card" key={index}>
                  <Placeholder className="customer-loading-label" />
                  <Placeholder className="customer-loading-value" />
                  <Placeholder className="customer-loading-caption" />
                </div>
              ))}
            </div>
            <div className="customer-loading-panel">
              <Placeholder className="customer-loading-section-title" />
              <PlaceholderRows count={5} />
            </div>
          </>
        )}

        {variant === "settings" && (
          <div className="customer-loading-settings">
            {Array.from({ length: 4 }, (_, index) => (
              <div className="customer-loading-card" key={index}>
                <Placeholder className="customer-loading-value" />
                <Placeholder className="customer-loading-caption" />
                <Placeholder className="customer-loading-caption customer-loading-short" />
              </div>
            ))}
          </div>
        )}

        {variant === "setting-detail" && (
          <div className="customer-loading-panel customer-loading-setting-detail">
            <Placeholder className="customer-loading-section-title" />
            <PlaceholderRows count={2} />
          </div>
        )}

        {variant === "catalog" && (
          <div className="customer-loading-catalog">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="customer-loading-card" key={index}>
                <Placeholder className="customer-loading-value" />
                <Placeholder className="customer-loading-caption" />
              </div>
            ))}
          </div>
        )}

        {variant === "service" && (
          <div className="customer-loading-panel customer-loading-service">
            <Placeholder className="customer-loading-section-title" />
            <PlaceholderRows count={4} />
          </div>
        )}

        {variant === "checkout" && (
          <div className="customer-loading-checkout">
            <div className="customer-loading-panel">
              <Placeholder className="customer-loading-section-title" />
              <PlaceholderRows count={4} />
            </div>
            <div className="customer-loading-panel">
              <Placeholder className="customer-loading-section-title" />
              <PlaceholderRows count={3} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
