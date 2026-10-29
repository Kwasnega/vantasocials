import Link from "next/link";
import { BundleUpReturnStatus } from "../../../../components/payments/BundleUpReturnStatus";
import { getCurrentUser } from "../../../../lib/supabase/server";

const PAYMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function BundleUpPaymentReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ payment_id?: string | string[] }>;
}) {
  const { payment_id: paymentId } = await searchParams;

  return (
    <main className="service-page">
      <Link href="/">VANTA</Link>
      <p className="section-kicker">PAYMENT</p>
      <h1>BundleUp payment return</h1>
      {!paymentId || Array.isArray(paymentId) || !PAYMENT_ID_PATTERN.test(paymentId) ? (
        <p>We could not identify this payment attempt. Check your orders or contact support.</p>
      ) : (
        <AuthenticatedReturn paymentId={paymentId.toLowerCase()} />
      )}
    </main>
  );
}

async function AuthenticatedReturn({ paymentId }: { paymentId: string }) {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <>
        <p>Sign in to check your payment status. This return does not confirm payment.</p>
        <Link href="/login">Sign in</Link>
      </>
    );
  }
  return <BundleUpReturnStatus paymentId={paymentId} />;
}
