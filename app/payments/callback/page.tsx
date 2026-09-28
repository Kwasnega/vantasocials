import Link from "next/link";
import { redirect } from "next/navigation";

export default async function PaymentCallback({ searchParams }: { searchParams: Promise<{ reference?: string }> }) {
  const { reference } = await searchParams;
  if (reference) redirect(`/payment-result?reference=${encodeURIComponent(reference)}`);
  return <main className="service-page"><Link href="/">VANTA</Link><h1>Payment reference missing</h1><p>We could not verify this payment return.</p></main>;
}
