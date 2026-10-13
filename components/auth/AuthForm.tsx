"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AuthChangeEvent, Session } from "@supabase/auth-js";
import posthog from "posthog-js";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";

function identifyUser(user: { id: string; email?: string }) {
  if (!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN || !process.env.NEXT_PUBLIC_POSTHOG_HOST) return;
  posthog.identify(user.id, user.email ? { email: user.email } : {});
}

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

    let unsubscribeAuthListener = () => {};
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: authListener } = supabase.auth.onAuthStateChange((
        event: AuthChangeEvent,
        session: Session | null,
      ) => {
        if (event !== "SIGNED_IN" || !session?.user) return;
        identifyUser(session.user);
        const requestedNext = safeNext(searchParams.get("next"));
        window.location.replace(requestedNext !== "/" ? requestedNext : "/account");
      });
      unsubscribeAuthListener = () => authListener.subscription.unsubscribe();

      let signInTimeoutId: number | undefined;
      const signInResult = await Promise.race([
        supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        }).then((result: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>) => ({
          timedOut: false as const,
          result,
        })),
        new Promise<{ timedOut: true }>((resolve) => {
          signInTimeoutId = window.setTimeout(() => resolve({ timedOut: true }), 15000);
        }),
      ]);
      if (signInTimeoutId !== undefined) window.clearTimeout(signInTimeoutId);

      if (signInResult.timedOut) {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 5000);
        try {
          const response = await fetch("/api/auth/redirect", {
            cache: "no-store",
            signal: controller.signal,
          });
          if (response.ok) {
            const body = (await response.json()) as { redirectTo?: string };
            if (body.redirectTo) {
              window.location.replace(safeNext(body.redirectTo));
              return;
            }
          }
        } catch {
          // The session may not have been saved; show a retryable error below.
        } finally {
          window.clearTimeout(timeoutId);
        }

        unsubscribeAuthListener();
        setError("Sign-in is taking longer than expected. Please try again.");
        setLoading(false);
        return;
      }

      const { data, error: authError } = signInResult.result;

      if (authError) {
        unsubscribeAuthListener();
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
        unsubscribeAuthListener();
        setError("Sign-in succeeded but user session could not be established.");
        setLoading(false);
        return;
      }

      unsubscribeAuthListener();
      const requestedNext = safeNext(searchParams.get("next"));
      const destination = requestedNext !== "/"
        ? requestedNext
        : "/account";
      window.location.replace(destination);
    } catch (err) {
      unsubscribeAuthListener();
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

      if (data.session && data.user) {
        identifyUser(data.user);
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
