import Link from "next/link";
import { Suspense } from "react";
import { SignupForm } from "../../components/auth/AuthForm";

export default function SignupPage() { return <main className="service-page"><Link href="/">VANTA</Link><p className="section-kicker">ACCOUNT</p><h1>Start growing</h1><p>Create your VANTA account.</p><Suspense><SignupForm /></Suspense><p><Link href="/login">Already have an account? Log in</Link></p></main>; }
