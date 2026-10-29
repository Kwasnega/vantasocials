"use client";

import { useEffect } from "react";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";

export function PostHogUserIdentifier({ userId, email }: { userId: string; email?: string }) {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN || !process.env.NEXT_PUBLIC_POSTHOG_HOST) return;
    const identify = () => {
      import("posthog-js").then(({ default: posthog }) => {
        posthog.identify(userId, email ? { email } : {});
      });
    };
    const win = window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void };
    if (typeof win.requestIdleCallback === "function") {
      win.requestIdleCallback(identify, { timeout: 2000 });
    } else {
      setTimeout(identify, 100);
    }
  }, [email, userId]);

  return null;
}

export function LogoutButton() {
  async function logout() {
    const { error } = await createSupabaseBrowserClient().auth.signOut();
    if (!error && process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_HOST) {
      try {
        const { default: posthog } = await import("posthog-js");
        posthog.reset();
      } catch {
        /* best-effort reset */
      }
    }
    window.location.href = "/";
  }
  return <button type="button" onClick={logout}>Log out</button>;
}
