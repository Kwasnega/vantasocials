import type { Metadata } from "next";
import { LegalPage } from "../../components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service | VANTA",
  description: "Terms for using VANTA and ordering social media growth services.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" kicker="USING VANTA">
      <p>
        These terms apply when you use VANTA’s website, create an account, place
        an order, or add funds to a VANTA wallet. By continuing to use the
        service, you agree to these terms. If you do not agree, do not place an
        order.
      </p>

      <h2>What VANTA provides</h2>
      <p>
        VANTA offers online social media growth and engagement services for the
        platforms and targets shown in the catalog. The exact service, quantity,
        eligibility limits, price, and any service-specific delivery information
        shown at checkout form part of your order. Prices and totals are shown
        before you choose to pay. Your order is not paid until VANTA confirms
        payment.
      </p>

      <h2>Accounts and order information</h2>
      <p>
        You must provide accurate account and order information and keep your
        sign-in details secure. You are responsible for activity on your account.
        Supply only a valid target and the information requested for the selected
        service. VANTA will never ask you for your social media account password.
      </p>
      <p>
        You are responsible for checking the selected platform, service, target,
        and quantity before payment. Keep the target publicly accessible and
        eligible for the selected service while delivery is in progress. VANTA
        may be unable to correct an order after fulfillment has started.
      </p>

      <h2>Payment and wallet funds</h2>
      <p>
        Online payments are processed by Paystack. VANTA does not store your
        full card number or card security code. We may retain payment references,
        amounts, currency, and payment status so we can confirm and support your
        transaction. Wallet deposits are credited only after payment is
        independently verified. Wallet funds are available for eligible VANTA
        orders and are not a bank account or interest-bearing product.
      </p>
      <p>
        If payment status is unclear, check your account or contact support
        before retrying. Do not place duplicate orders or make repeated payments
        while a transaction is being confirmed.
      </p>

      <h2>Delivery and service limitations</h2>
      <p>
        Fulfillment begins after payment confirmation and is subject to the
        selected service’s stated terms, target eligibility, provider
        availability, and platform conditions. Delivery estimates are not
        guarantees unless a specific guarantee is stated for that service.
        Social platforms may change, remove, or limit engagement, accounts, or
        content. VANTA cannot control those platform decisions and does not
        guarantee reach, sales, audience growth, account standing, or any other
        business outcome.
      </p>

      <h2>Acceptable use</h2>
      <p>
        You must use VANTA lawfully and comply with the terms and rules of the
        relevant social platform. Do not use the service to harass, impersonate,
        defraud, threaten, or distribute unlawful or harmful content. VANTA may
        decline, pause, or cancel an order where needed to protect users, comply
        with law, or address misuse. Any eligible refund is handled under our{" "}
        <a href="/refund-policy">refund policy</a>.
      </p>
      <p>
        VANTA is an independent service and is not sponsored, endorsed, or
        administered by Instagram, TikTok, YouTube, Facebook, X, Telegram, or
        other named platforms. Platform names and marks identify the services
        compatible with an order.
      </p>

      <h2>Refunds, availability, and changes</h2>
      <p>
        Refund and cancellation requests are handled under the{" "}
        <a href="/refund-policy">refund policy</a>. We may update the catalog,
        prices, or these terms. A change to the terms will be posted on this page
        with a revised date. The terms in effect when you submit an order apply
        to that order, except where a change is required by law.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms or an order? Contact{" "}
        <a href="mailto:vantasocials62@gmail.com">vantasocials62@gmail.com</a>.
      </p>
    </LegalPage>
  );
}
