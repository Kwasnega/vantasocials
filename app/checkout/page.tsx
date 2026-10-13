import Link from "next/link";
import { CheckoutPaymentOptions } from "../../components/checkout/CheckoutPaymentOptions";
import { getPlatformLogoUrl } from "../../lib/catalog/logo";
import { getCheckoutOrder } from "../../lib/orders/checkout";
import { formatOrderInputValue } from "../../lib/orders/display-input-values";

export const dynamic = "force-dynamic";

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const { order: publicOrderId } = await searchParams;
  const checkoutOrder = publicOrderId ? await getCheckoutOrder(publicOrderId) : null;

  if (!checkoutOrder) {
    return (
      <main className="checkout-shell">
        <header className="checkout-topbar">
          <Link href="/" className="checkout-brand" aria-label="VANTA home">
            <span className="brand-mark">V</span>VANTA
          </Link>
          <div className="checkout-topbar-actions">
            <Link href="/new-order" className="checkout-back-link">
              ← Browse Services
            </Link>
          </div>
        </header>

        <section className="checkout-container">
          <div className="checkout-empty-state">
            <div className="checkout-empty-icon" aria-hidden="true">?</div>
            <p className="checkout-kicker">CHECKOUT</p>
            <h1>Order Not Found</h1>
            <p className="checkout-empty-desc">
              We could not find an active order matching <strong>{publicOrderId || "the requested ID"}</strong>.
              The order may have expired, or you may be signed in under a different account.
            </p>
            <div className="checkout-empty-actions">
              <Link href="/new-order" className="checkout-btn checkout-btn-primary">
                Browse Services
              </Link>
              <Link href="/account" className="checkout-btn checkout-btn-outline">
                Go to Dashboard
              </Link>
            </div>
          </div>
        </section>
      </main>
    );
  }

  const isPaid = checkoutOrder.payment_status === "PAID";
  const payable = checkoutOrder.status === "PENDING_PAYMENT" && checkoutOrder.payment_status === "UNPAID";
  const platformLogo = checkoutOrder.platform_slug ? getPlatformLogoUrl(checkoutOrder.platform_slug) : null;

  return (
    <main className="checkout-shell">
      {/* Checkout Navigation Topbar */}
      <header className="checkout-topbar">
        <div className="checkout-topbar-left">
          <Link href="/" className="checkout-brand" aria-label="VANTA home">
            <span className="brand-mark">V</span>VANTA
          </Link>
          <span className="checkout-badge-secure">
            <span className="secure-dot" aria-hidden="true" /> 256-bit Secure Checkout
          </span>
        </div>
        <div className="checkout-topbar-actions">
          <Link href="/new-order" className="checkout-back-link">
            ← Change Service
          </Link>
          <Link href="/account/orders" className="checkout-sub-link">
            My Orders
          </Link>
        </div>
      </header>

      <div className="checkout-container">
        <header className="checkout-header-hero">
          <p className="checkout-kicker">STEP 2 OF 2 · ORDER REVIEW</p>
          <h1>Review &amp; Complete Order</h1>
          <p className="checkout-subtitle">
            Verify the order parameters below before continuing to instant fulfillment.
          </p>
        </header>

        {isPaid ? (
          <div className="checkout-paid-banner">
            <div className="checkout-paid-icon">✓</div>
            <div className="checkout-paid-content">
              <h2>This Order is Already Paid</h2>
              <p>
                Order <strong>{checkoutOrder.public_order_id}</strong> is currently{" "}
                <span className="checkout-status-pill">{checkoutOrder.fulfillment_status || "PROCESSING"}</span>.
                Automated delivery is already underway.
              </p>
            </div>
            <div className="checkout-paid-actions">
              <Link href={`/account/orders/${checkoutOrder.public_order_id}`} className="checkout-btn checkout-btn-primary">
                Track Order Status →
              </Link>
              <Link href="/new-order" className="checkout-btn checkout-btn-outline">
                Start New Order
              </Link>
            </div>
          </div>
        ) : !payable ? (
          <div className="checkout-alert-box">
            <div className="checkout-alert-icon">!</div>
            <div>
              <h3>Order Unavailable for Payment</h3>
              <p>
                This order is in <strong>{checkoutOrder.status}</strong> status and cannot be paid at this time.
              </p>
            </div>
            <Link href="/new-order" className="checkout-btn checkout-btn-primary">
              Create New Order
            </Link>
          </div>
        ) : (
          <div className="checkout-grid">
            {/* Left Column: Order Overview (What you are buying) */}
            <div className="checkout-left-col">
              <div className="checkout-card checkout-item-card">
                <div className="checkout-item-header">
                  <div className="checkout-item-platform-wrap">
                    <span className="checkout-platform-logo">
                      {platformLogo ? (
                        <img src={platformLogo} alt={checkoutOrder.platform} />
                      ) : (
                        <span>{checkoutOrder.platform.slice(0, 2).toUpperCase()}</span>
                      )}
                    </span>
                    <div>
                      <span className="checkout-item-eyebrow">
                        {checkoutOrder.platform} {checkoutOrder.category ? `· ${checkoutOrder.category}` : ""}
                      </span>
                      <h2 className="checkout-item-title">{checkoutOrder.service_name}</h2>
                    </div>
                  </div>
                  <span className="checkout-order-tag">
                    #{checkoutOrder.public_order_id}
                  </span>
                </div>

                <div className="checkout-specs-list">
                  <div className="checkout-spec-row">
                    <span className="checkout-spec-label">Target {checkoutOrder.target_type}</span>
                    <span className="checkout-spec-value checkout-target-highlight">
                      {checkoutOrder.target_value}
                    </span>
                  </div>

                  <div className="checkout-spec-row">
                    <span className="checkout-spec-label">Quantity</span>
                    <span className="checkout-spec-value">
                      <strong>{checkoutOrder.quantity.toLocaleString()}</strong> units
                    </span>
                  </div>

                  {checkoutOrder.input_values && typeof checkoutOrder.input_values === "object" && Object.keys(checkoutOrder.input_values).length > 0 && (
                    <div className="checkout-spec-extra">
                      <span className="checkout-spec-label">Order Details</span>
                      <div className="checkout-dynamic-snapshot">
                        {Object.entries(checkoutOrder.input_values).map(([key, val]) => (
                          <div key={key} className="checkout-dyn-row">
                            <span className="checkout-dyn-key">{key}:</span>
                            <span className="checkout-dyn-val">{formatOrderInputValue(val)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Price Breakdown / Receipt Table */}
                <div className="checkout-receipt">
                  <div className="checkout-receipt-total-row">
                    <div>
                      <strong>Total Due</strong>
                      <small>All taxes &amp; fulfillment included</small>
                    </div>
                    <div className="checkout-total-price">
                      <span>{checkoutOrder.total}</span>
                      <small>{checkoutOrder.currency}</small>
                    </div>
                  </div>
                </div>
              </div>

              {/* Guarantees & Reassurance Cards */}
              <div className="checkout-guarantees-grid">
                <div className="checkout-guarantee-card">
                  <span className="guarantee-icon">⚡</span>
                  <div>
                    <strong>Instant Automated Delivery</strong>
                    <p>Fulfillment dispatch begins automatically once payment is verified.</p>
                  </div>
                </div>
                <div className="checkout-guarantee-card">
                  <span className="guarantee-icon">🛡️</span>
                  <div>
                    <strong>Money-Back Guarantee</strong>
                    <p>Qualifying orders are backed by automated wallet refunds if undeliverable.</p>
                  </div>
                </div>
                <div className="checkout-guarantee-card">
                  <span className="guarantee-icon">🔒</span>
                  <div>
                    <strong>No Password Ever Required</strong>
                    <p>We only deliver to public handles or URLs. Your social credentials stay private.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Payment Method & Action */}
            <div className="checkout-right-col">
              <div className="checkout-card checkout-payment-card">
                <div className="checkout-payment-card-header">
                  <h3>Select Payment Method</h3>
                  <p>Choose your preferred payment method to complete this order.</p>
                </div>

                <CheckoutPaymentOptions
                  orderId={checkoutOrder.public_order_id}
                  balanceMinor={checkoutOrder.wallet_balance_minor}
                  totalAmount={checkoutOrder.total}
                  currency={checkoutOrder.currency}
                />
              </div>

              <div className="checkout-support-card">
                <p>
                  Need assistance with this order? Our support team is here to help at{" "}
                  <a href="mailto:vantasocials62@gmail.com">vantasocials62@gmail.com</a>.
                </p>
                <p className="checkout-legal-links">
                  By continuing, you agree to our <Link href="/terms">Terms</Link>,{" "}
                  <Link href="/refund-policy">Refund Policy</Link>, and{" "}
                  <Link href="/privacy-policy">Privacy Policy</Link>.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
