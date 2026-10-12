import type { Metadata } from "next";
import { LegalPage } from "../../components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Refund Policy | VANTA",
  description: "How VANTA reviews cancellations, undelivered orders, and refund requests.",
};

export default function RefundPolicyPage() {
  return (
    <LegalPage title="Refund policy" kicker="CLEAR ORDERS · FAIR RESOLUTIONS">
      <p>
        This policy explains when you may request a refund for a VANTA order or an
        unused wallet deposit. Please contact us as soon as you notice a problem.
      </p>

      <h2>When an order may qualify</h2>
      <ul>
        <li>
          If an order fails before delivery, we will review the order and the
          payment and, where the service was not delivered, refund the undelivered
          amount or offer another resolution with your agreement.
        </li>
        <li>
          If an order is only partly delivered, we may refund the undelivered
          portion after checking the order and available delivery records.
        </li>
        <li>
          If VANTA cannot start or complete an order and no meaningful part of the
          service was delivered, you may request a refund of the amount paid for
          that order.
        </li>
        <li>
          We review duplicate charges and payments that were taken even though an
          order or deposit was not successfully created or credited.
        </li>
      </ul>

      <h2>When an order is not normally refundable</h2>
      <ul>
        <li>
          A service has already been fully delivered, including where the result
          later changes because a social platform removes, adjusts, or otherwise
          changes engagement.
        </li>
        <li>
          Delivery has started and the request is based on a change of mind,
          incorrect target, incorrect service or quantity selected by you, or
          account/content settings that prevented delivery.
        </li>
        <li>
          The target was made private, removed, renamed, restricted, or otherwise
          made unavailable after you placed the order.
        </li>
      </ul>
      <p>
        These examples do not limit rights that cannot legally be excluded.
        Contact us if you believe an order was not delivered as described; we will
        assess its actual status rather than treating a pending order as complete.
      </p>

      <h2>Cancellations</h2>
      <p>
        You may ask to cancel while an order is still awaiting payment or has not
        entered processing. Once fulfillment has started, cancellation may no
        longer be possible. Contact support promptly with your public order ID.
        Do not make a second order while the first order is still being reviewed.
      </p>

      <h2>Wallet deposits</h2>
      <p>
        You may request a review of an unused wallet deposit. We will first check
        whether the deposit was successfully paid and credited and whether any of
        the balance has been used or is committed to a pending order. Amounts
        already spent on orders are handled under the order rules above. Approved
        refunds are returned to the original payment method where the payment
        provider supports it; we do not treat an uncredited or failed payment as
        available wallet funds.
      </p>

      <h2>How to request help or a refund</h2>
      <p>
        Email <a href="mailto:vantasocials62@gmail.com">vantasocials62@gmail.com</a>{" "}
        from the email address on your account. Include your public order ID or
        deposit reference, the amount and date, and a short description of the
        issue. Never send your password, full card number, security code, or
        one-time payment code.
      </p>
      <p>
        We aim to acknowledge requests within 5 business days. If approved, we
        will confirm the amount and initiate the refund to the original payment
        method. The time for the credit to appear depends on Paystack and your
        bank or payment provider. VANTA does not promise a specific posting date.
      </p>
      <p>
        If you paid through Paystack, a payment receipt or a successful charge
        alone does not show whether an order was delivered. We check the VANTA
        order and payment records before deciding a request.
      </p>
    </LegalPage>
  );
}
