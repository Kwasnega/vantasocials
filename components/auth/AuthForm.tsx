"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}

export function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!email.trim() || password.length < 6) {
      setError("Enter a valid email and password (minimum 6 characters).");
      return;
    }
    setLoading(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        const msg = authError.message.toLowerCase();
        if (msg.includes("email not confirmed")) {
          setError("Please confirm your email address before signing in. Check your inbox or spam folder for the confirmation link.");
        } else if (msg.includes("invalid login credentials") || msg.includes("invalid_credentials")) {
          setError("Invalid email or password. Please verify your credentials and try again.");
        } else {
          setError(authError.message || "Unable to sign in with those details.");
        }
        setLoading(false);
        return;
      }

      if (!data.user) {
        setError("Sign-in succeeded but user session could not be established.");
        setLoading(false);
        return;
      }

      // Determine destination
      const requestedNext = safeNext(searchParams.get("next"));
      let destination = requestedNext !== "/" ? requestedNext : "/account";

      try {
        const redirectUrl = requestedNext && requestedNext !== "/" ? `/api/auth/redirect?next=${encodeURIComponent(requestedNext)}` : "/api/auth/redirect";
        const response = await fetch(redirectUrl);
        if (response.ok) {
          const body = (await response.json()) as { redirectTo?: string };
          if (body.redirectTo) destination = body.redirectTo;
        }
      } catch {
        // Fallback to /account
      }

      // Hard redirect to guarantee fresh cookies are sent to server components
      window.location.href = destination || "/account";
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred. Please try again.");
      setLoading(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button
        type="submit"
        className={`service-action-link auth-submit${loading ? " is-loading" : ""}`}
        disabled={loading}
      >
        <span>{loading ? "Signing in…" : "Log in"}</span>
        {loading && <i aria-hidden="true" />}
      </button>
    </form>
  );
}

export function SignupForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!email.trim() || password.length < 6) {
      setError("Use a valid email and a password with at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });

      if (authError) {
        setError(authError.message || "Unable to create the account.");
        setLoading(false);
        return;
      }

      if (data.session) {
        const next = safeNext(searchParams.get("next"));
        window.location.href = next && next !== "/" ? next : "/account";
        return;
      }

      setMessage("Account created! Check your email to confirm your address, then log in.");
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setLoading(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
      </label>
      <label>
        Confirm password
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button
        type="submit"
        className={`service-action-link auth-submit${loading ? " is-loading" : ""}`}
        disabled={loading}
      >
        <span>{loading ? "Creating account…" : "Create account"}</span>
        {loading && <i aria-hidden="true" />}
      </button>
    </form>
  );
}
