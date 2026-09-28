"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function PaymentResultPage() {
  const [message, setMessage] = useState("Verifying payment…");
  useEffect(() => {
    const reference = new URLSearchParams(window.location.search).get("reference");
    if (!reference) { setMessage("Payment reference missing."); return; }
    fetch("/api/payments/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reference }) }).then(async (response) => {
      const body = await response.json();
      setMessage(response.ok && body.paid ? "Payment confirmed." : body.error || "Payment could not be confirmed.");
    }).catch(() => setMessage("Payment verification is temporarily unavailable."));
  }, []);
  return <main className="service-page"><Link href="/">VANTA</Link><p className="section-kicker">PAYMENT</p><h1>{message}</h1><p>Payment confirmation is determined by VANTA’s server.</p></main>;
}
