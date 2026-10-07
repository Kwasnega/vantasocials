"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!email.trim() || password.length < 6) { setError("Enter a valid email and password."); return; }
    setLoading(true);
    const { error: authError } = await createSupabaseBrowserClient().auth.signInWithPassword({ email: email.trim(), password });
    if (authError) { setError(authError.message.toLowerCase().includes("email not confirmed") ? "Please confirm your email address before signing in. Check your inbox or spam folder for the confirmation link." : "Unable to sign in with those details."); setLoading(false); return; }
    const requestedNext = searchParams.get("next");
    const redirectUrl = requestedNext ? `/api/auth/redirect?next=${encodeURIComponent(requestedNext)}` : "/api/auth/redirect";
    const destination = await fetch(redirectUrl).then(async (response) => {
      if (!response.ok) throw new Error("Unable to determine the account destination.");
      return (await response.json() as { redirectTo?: string }).redirectTo;
    }).catch(() => null);
    router.replace(destination || "/account"); router.refresh();
  }
  return <form className="auth-form" onSubmit={submit}><label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label><label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>{error && <p role="alert">{error}</p>}<button className={`service-action-link auth-submit${loading ? " is-loading" : ""}`} disabled={loading}><span>{loading ? "Signing in…" : "Log in"}</span>{loading && <i aria-hidden="true" />}</button></form>;
}

export function SignupForm() {
  const router = useRouter(); const searchParams = useSearchParams();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setMessage("");
    if (!email.trim() || password.length < 6) { setError("Use a valid email and a password with at least 6 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true);
    const { data, error: authError } = await createSupabaseBrowserClient().auth.signUp({ email: email.trim(), password });
    if (authError) { setError("Unable to create the account."); setLoading(false); return; }
    if (data.session) { router.replace(safeNext(searchParams.get("next"))); router.refresh(); return; }
    setMessage("Account created. Check your email to confirm your address, then log in."); setLoading(false);
  }
  return <form className="auth-form" onSubmit={submit}><label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label><label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required /></label><label>Confirm password<input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required /></label>{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}<button className="service-action-link" disabled={loading}>{loading ? "Creating account…" : "Create account"}</button></form>;
}
