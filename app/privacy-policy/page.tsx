import type { Metadata } from "next";
import { LegalPage } from "../../components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy | VANTA",
  description: "How VANTA uses account, order, and payment information.",
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPage title="Privacy policy" kicker="YOUR INFORMATION">
      <p>
        This policy describes information VANTA handles when you visit the site,
        create an account, place an order, contact support, or use wallet
        features. We use information to provide the service, protect accounts,
        and resolve payment and order issues.
      </p>

      <h2>Information we handle</h2>
      <ul>
        <li>
          Account details, such as your email address, authentication/session
          information, and account identifiers.
        </li>
        <li>
          Order details, including the chosen service and quantity, target URL or
          other information you submit for the service, order status, and
          support communications.
        </li>
        <li>
          Payment records such as transaction references, amount, currency,
          payment status, and wallet deposit history. Paystack handles payment
          credentials through its payment flow; VANTA does not store your full
          card number or card security code.
        </li>
        <li>
          Basic technical and security information needed to operate the website,
          maintain sessions, prevent abuse, and diagnose service issues.
        </li>
      </ul>

      <h2>How information is used</h2>
      <p>
        We use this information to create and secure accounts, calculate and
        manage orders, confirm payments, arrange fulfillment, maintain order and
        wallet records, respond to support requests, prevent fraud or misuse,
        and meet applicable legal obligations.
      </p>

      <h2>When information is shared</h2>
      <p>
        We share only the information needed for a task with service providers
        that help operate VANTA. Paystack processes payments and may return
        payment references and transaction status. Our hosting, database, and
        authentication providers support the website and account features.
        Fulfillment providers receive the order details needed to deliver the
        service, which may include the target and quantity. These providers
        process information under their own terms and privacy practices.
      </p>
      <p>
        We may also disclose information when required by law or when reasonably
        necessary to protect users, investigate fraud, or secure VANTA. We do
        not sell personal information.
      </p>

      <h2>Retention and security</h2>
      <p>
        We keep account, order, and payment records for as long as needed to
        operate the service, provide support, maintain financial records, resolve
        disputes, and meet legal obligations. Retention periods can therefore
        differ by record type. We use reasonable safeguards, but no online
        service can guarantee absolute security.
      </p>

      <h2>Cookies and account sessions</h2>
      <p>
        VANTA uses browser storage and session mechanisms needed for
        authentication, security, and core site functionality. Blocking these
        may prevent sign-in or checkout from working. This policy does not
        promise that every browser or third-party integration uses no additional
        technologies; consult the relevant provider’s privacy information for
        its processing.
      </p>

      <h2>Your choices and requests</h2>
      <p>
        You can contact us to ask about, correct, or request deletion of account
        information, subject to records we need to keep for completed
        transactions, security, or legal obligations. Email{" "}
        <a href="mailto:vantasocials62@gmail.com">vantasocials62@gmail.com</a>{" "}
        from your account address and describe your request. Do not send
        passwords or payment security codes.
      </p>

      <h2>Third-party services and children</h2>
      <p>
        Paystack, social platforms, hosting providers, and fulfillment partners
        have their own terms and privacy policies. VANTA is not responsible for
        privacy practices on third-party websites. VANTA is intended for people
        who can legally use the service and make online purchases in their
        jurisdiction; do not create an account if you are not permitted to do so.
      </p>

      <h2>Policy updates and contact</h2>
      <p>
        We may update this policy as the service changes. The current version
        will be posted here with its revision date. Privacy questions or
        requests can be sent to{" "}
        <a href="mailto:vantasocials62@gmail.com">vantasocials62@gmail.com</a>.
      </p>
    </LegalPage>
  );
}
