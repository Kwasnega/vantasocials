"use client";

import { useEffect } from "react";
import posthog from "posthog-js";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";

export function PostHogUserIdentifier({ userId, email }: { userId: string; email?: string }) {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN || !process.env.NEXT_PUBLIC_POSTHOG_HOST) return;
    posthog.identify(userId, email ? { email } : {});
  }, [email, userId]);

  return null;
}

export function LogoutButton() {
  async function logout() {
    const { error } = await createSupabaseBrowserClient().auth.signOut();
    if (!error && process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_HOST) posthog.reset();
    window.location.href = "/";
  }
  return <button type="button" onClick={logout}>Log out</button>;
}
