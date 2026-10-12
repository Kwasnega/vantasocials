import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { SignupForm } from "../../components/auth/AuthForm";
import { getCurrentUser } from "../../lib/supabase/server";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await getCurrentUser();
  const { next } = await searchParams;
  if (user) {
    redirect(next && next.startsWith("/") ? next : "/account");
  }
  return <main className="login-page signup-page">
    <section className="login-atmosphere" aria-hidden="true">
      <Link className="login-brand" href="/">VANTA</Link>
      <div className="login-orbit orbit-one" /><div className="login-orbit orbit-two" /><div className="login-orbit orbit-three" />
      <div className="login-stamp">V</div>
      <div className="login-atmosphere-copy"><span>YOUR NEXT MOVE</span><strong>Start<br />growing.</strong><small>Build momentum with clarity.</small></div>
    </section>
    <section className="login-content">
      <div className="login-heading"><p className="section-kicker">ACCOUNT</p><h1>Sign up</h1><p>Create your VANTA account and keep your next move in motion.</p></div>
      <Suspense><SignupForm /></Suspense>
      <p className="login-signup">Already have an account? <Link href="/login">Log in</Link></p>
      <p className="login-legal">By creating an account, you agree to VANTA’s terms and privacy policy.</p>
    </section>
  </main>;
}
