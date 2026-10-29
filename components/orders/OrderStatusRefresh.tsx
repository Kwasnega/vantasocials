"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const terminalStatuses = new Set(["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"]);
const pollableStatuses = new Set(["NOT_STARTED", "SUBMITTING", "SUBMITTED", "PROCESSING"]);

const BACKOFF_SCHEDULE = [3000, 5000, 8000, 13000, 21000, 30000];
const MAX_POLLING_DURATION_MS = 300000; // 5 minutes

export default function OrderStatusRefresh({
  publicOrderId,
  paymentStatus,
  fulfillmentStatus,
}: {
  publicOrderId: string;
  paymentStatus: string;
  fulfillmentStatus: string;
}) {
  const router = useRouter();
  const [pollingTimedOut, setPollingTimedOut] = useState(false);
  const attemptRef = useRef(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const inFlightRef = useRef(false);
  const startTimeRef = useRef(Date.now());
  const isTabVisibleRef = useRef(true);

  useEffect(() => {
    if (paymentStatus !== "PAID" || !pollableStatuses.has(fulfillmentStatus) || terminalStatuses.has(fulfillmentStatus)) {
      return;
    }

    startTimeRef.current = Date.now();
    attemptRef.current = 0;
    setPollingTimedOut(false);

    const handleVisibilityChange = () => {
      const isVisible = document.visibilityState === "visible";
      isTabVisibleRef.current = isVisible;
      if (isVisible && !timerRef.current && !inFlightRef.current) {
        scheduleNext(0);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    const scheduleNext = (delayMs: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void poll();
      }, delayMs);
    };

    const poll = async () => {
      if (!isTabVisibleRef.current) return;

      if (Date.now() - startTimeRef.current >= MAX_POLLING_DURATION_MS) {
        setPollingTimedOut(true);
        return;
      }

      inFlightRef.current = true;
      try {
        const response = await fetch(`/api/account/orders/${encodeURIComponent(publicOrderId)}/status`, {
          cache: "no-store",
          credentials: "same-origin",
        });

        if (response.ok) {
          const status = (await response.json()) as { paymentStatus?: string; fulfillmentStatus?: string };
          if (
            status.paymentStatus !== paymentStatus ||
            status.fulfillmentStatus !== fulfillmentStatus
          ) {
            router.refresh();
            return;
          }

          if (status.fulfillmentStatus && terminalStatuses.has(status.fulfillmentStatus)) {
            return;
          }
        }
      } catch {
        // Silently swallow network errors and continue backoff schedule
      } finally {
        inFlightRef.current = false;
      }

      const nextDelay = BACKOFF_SCHEDULE[Math.min(attemptRef.current, BACKOFF_SCHEDULE.length - 1)];
      attemptRef.current += 1;
      scheduleNext(nextDelay);
    };

    scheduleNext(BACKOFF_SCHEDULE[0]);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fulfillmentStatus, paymentStatus, publicOrderId, router]);

  if (pollingTimedOut) {
    return (
      <div className="order-status-timeout-banner" role="status">
        <span>Still waiting on provider update.</span>
        <button type="button" onClick={() => router.refresh()}>
          Refresh status
        </button>
      </div>
    );
  }

  return null;
}
