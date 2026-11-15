import Link from "next/link";
import { validateCustomerFixToken } from "../../../lib/orders/target-fix/service";
import { FixOrderForm } from "./FixOrderForm";

export const dynamic = "force-dynamic";

export default async function FixOrderPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const validation = await validateCustomerFixToken(token);

  return (
    <main className="min-h-screen bg-[#0b0c10] text-white flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-lg">
        {/* Header / Brand */}
        <header className="mb-8 text-center">
          <Link href="/" className="inline-block text-xl font-extrabold tracking-widest text-white hover:opacity-80 transition-opacity">
            VANTA
          </Link>
          <p className="mt-2 text-xs uppercase tracking-wider text-purple-400 font-semibold">
            Delivery Recovery
          </p>
        </header>

        {/* Card Body */}
        <div className="rounded-2xl border border-white/10 bg-[#14161f] p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
          {!validation.valid ? (
            <div className="text-center py-6">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-400 text-2xl" aria-hidden="true">
                !
              </div>
              <h1 className="text-lg font-bold text-white">
                {validation.errorCode === "ALREADY_FULFILLED"
                  ? "Order Already Fulfilled"
                  : validation.errorCode === "ALREADY_USED"
                  ? "Link Already Used"
                  : "Link Invalid or Expired"}
              </h1>
              <p className="mt-2 text-sm text-white/60 leading-relaxed">
                {validation.errorCode === "ALREADY_FULFILLED"
                  ? "This order has already been fulfilled or is currently in progress."
                  : validation.errorCode === "ALREADY_USED"
                  ? "This fix link was already submitted. Your order is already being processed."
                  : "This link is no longer valid or has expired. If you still need help with your order, please contact support."}
              </p>
              <div className="mt-6">
                <Link
                  href="/contact"
                  className="inline-flex items-center justify-center rounded-xl border border-white/20 bg-white/5 hover:bg-white/10 px-5 py-2.5 text-xs font-semibold text-white transition-colors min-h-[44px]"
                >
                  Contact Support
                </Link>
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-6">
                <h1 className="text-lg font-bold text-white">Update Your Order Link</h1>
                <p className="mt-1 text-xs text-white/60">
                  Order #{validation.order!.publicOrderId} · No additional payment required
                </p>
              </div>

              <FixOrderForm token={token} order={validation.order!} />
            </div>
          )}
        </div>

        {/* Footer info */}
        <footer className="mt-8 text-center text-xs text-white/40">
          VANTA Socials · Automated Delivery Infrastructure
        </footer>
      </div>
    </main>
  );
}
