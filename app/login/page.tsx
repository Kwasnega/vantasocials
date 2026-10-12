import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LoginForm } from "../../components/auth/AuthForm";
import { getCurrentUser } from "../../lib/supabase/server";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await getCurrentUser();
  const { next } = await searchParams;
  if (user) {
    redirect(next && next.startsWith("/") ? next : "/account");
  }
  return <main className="login-page">
    <section className="login-atmosphere" aria-hidden="true">
      <Link className="login-brand" href="/">VANTA</Link>
      <div className="login-orbit orbit-one" />
      <div className="login-orbit orbit-two" />
      <div className="login-orbit orbit-three" />
      <div className="login-stamp">V</div>
      <div className="login-atmosphere-copy"><span>THE VANTA WAY</span><strong>Move with<br />purpose.</strong><small>Social growth, simplified.</small></div>
    </section>
    <section className="login-content">
      <Link className="login-mobile-brand" href="/">VANTA</Link>
      <div className="login-heading"><p className="section-kicker">ACCOUNT</p><h1>Log in</h1><p>Sign in to continue to your VANTA order.</p></div>
      <Suspense><LoginForm /></Suspense>
      <p className="login-signup">Need an account? <Link href="/signup">Sign up</Link></p>
      <p className="login-legal">By continuing, you agree to VANTA’s terms and privacy policy.</p>
    </section>
  </main>;
}
