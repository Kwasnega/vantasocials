import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "../../components/auth/AuthForm";

export default function LoginPage() { return <main className="service-page"><Link href="/">VANTA</Link><p className="section-kicker">ACCOUNT</p><h1>Log in</h1><p>Sign in to continue to your VANTA order.</p><Suspense><LoginForm /></Suspense><p><Link href="/signup">Need an account? Sign up</Link></p></main>; }
