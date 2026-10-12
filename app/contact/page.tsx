import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "../../components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Contact VANTA | Customer Support",
  description: "Contact VANTA for order, wallet, and Paystack payment support.",
};

export default function ContactPage() {
  return (
    <LegalPage title="Contact VANTA" kicker="CUSTOMER SUPPORT · PAYMENT HELP">
      <p>
        VANTA is an online marketplace for social media growth services. Choose
        from the services shown in our catalog, review the service and total at
        checkout, then pay online or use an available wallet balance.
      </p>

      <h2>Customer and payment support</h2>
      <p>
        Email{" "}
        <a href="mailto:vantasocials62@gmail.com">vantasocials62@gmail.com</a>{" "}
        for order delivery, cancellation, refund, wallet, account, or payment
        questions. We aim to acknowledge support requests within 5 business days.
      </p>
      <ul>
        <li>Merchant name: VANTA</li>
        <li>Business location: Accra, Ghana</li>
        <li>
          Phone: <a href="tel:+233207959595">+233 20 795 9595</a>
        </li>
        <li>
          Email: <a href="mailto:vantasocials62@gmail.com">vantasocials62@gmail.com</a>
        </li>
      </ul>
      <p>
        For an order or payment issue, include your account email, public order
        ID or deposit reference, payment date, and amount. Never email your
        password, full card details, card security code, or one-time code.
      </p>

      <h2>Payments and order confirmation</h2>
      <p>
        Paystack processes online payments for VANTA. Payment confirmation is
        checked by VANTA before an order is treated as paid. If a bank or
        Paystack notification says a payment succeeded but your order still
        appears unpaid, contact us with the transaction reference so we can
        review it. Do not send card credentials.
      </p>

      <h2>Useful pages</h2>
      <ul>
        <li><Link href="/refund-policy">Refund and cancellation policy</Link></li>
        <li><Link href="/terms">Terms of service</Link></li>
        <li><Link href="/privacy-policy">Privacy policy</Link></li>
        <li><Link href="/new-order">Browse available services</Link></li>
        <li><Link href="/account">Customer account and order history</Link></li>
      </ul>
    </LegalPage>
  );
}
