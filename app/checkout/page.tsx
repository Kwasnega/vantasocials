import Link from "next/link";
import { CheckoutPaymentOptions } from "../../components/checkout/CheckoutPaymentOptions";
import { getCheckoutOrder } from "../../lib/orders/checkout";

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const { order: publicOrderId } = await searchParams;
  const checkoutOrder = publicOrderId ? await getCheckoutOrder(publicOrderId) : null;

  if (!checkoutOrder) {
    return <main className="service-page"><Link href="/">VANTA</Link><p className="section-kicker">CHECKOUT</p><h1>Order not found</h1><p>We could not find an order available to this account.</p></main>;
  }

  const payable = checkoutOrder.status === "PENDING_PAYMENT" && checkoutOrder.payment_status === "UNPAID";
  return <main className="service-page">
    <Link href="/">VANTA</Link>
    <p className="section-kicker">CHECKOUT</p>
    <h1>Review your order</h1>
    <p>{checkoutOrder.service_name} · {checkoutOrder.platform}</p>
    <p>Target: {checkoutOrder.target_value}</p>
    <p>Quantity: {checkoutOrder.quantity}</p>
    <p>Amount: {checkoutOrder.total} {checkoutOrder.currency}</p>
    {payable ? <CheckoutPaymentOptions orderId={checkoutOrder.public_order_id} balanceMinor={checkoutOrder.wallet_balance_minor} /> : <p>This order is not available for payment in its current state.</p>}
  </main>;
}
