const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

if (typeof window !== "undefined" && projectToken && host) {
  const initPostHog = () => {
    import("posthog-js").then(({ default: posthog }) => {
      posthog.init(projectToken, {
        api_host: host,
        defaults: "2025-05-24",
        capture_exceptions: true,
        debug: process.env.NODE_ENV === "development",
      });
    });
  };

  const scheduleInit = () => {
    const win = window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void };
    if (typeof win.requestIdleCallback === "function") {
      win.requestIdleCallback(initPostHog, { timeout: 3000 });
    } else {
      setTimeout(initPostHog, 500);
    }
  };

  if (document.readyState === "complete") {
    scheduleInit();
  } else {
    window.addEventListener("load", scheduleInit, { once: true });
  }
} else if (process.env.NODE_ENV === "development") {
  if (!projectToken) {
    console.error(
      new Error(
        "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured",
      ),
    );
  }

  if (!host) {
    console.error(
      new Error(
        "NEXT_PUBLIC_POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_HOST is configured",
      ),
    );
  }
}
