"use client";

import React, { useState } from "react";
import { LinkPreviewCard } from "../../../components/services/LinkPreviewCard";
import type { LinkPreviewData, LinkPreviewErrorCode } from "../../../lib/link-preview/types";
import { normalizeTarget } from "../../../lib/targets/normalize";

interface FixOrderFormProps {
  token: string;
  order: {
    publicOrderId: string;
    serviceName: string;
    platformName: string;
    platformSlug: string;
    targetType: string;
    targetValue: string;
    quantity: number;
  };
}

export function FixOrderForm({ token, order }: FixOrderFormProps) {
  const [newTarget, setNewTarget] = useState("");
  const [canonicalTarget, setCanonicalTarget] = useState("");
  const [normalizationError, setNormalizationError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [succeeded, setSucceeded] = useState(false);

  // Link Preview states
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<LinkPreviewData | null>(null);
  const [previewErrorCode, setPreviewErrorCode] = useState<LinkPreviewErrorCode | null>(null);
  const [previewConfirmed, setPreviewConfirmed] = useState(false);

  // Live normalization as user types or on blur
  async function handleNormalize(inputVal: string) {
    if (!inputVal.trim()) {
      setCanonicalTarget("");
      setNormalizationError("");
      setPreviewData(null);
      setPreviewErrorCode(null);
      return;
    }

    try {
      const res = await normalizeTarget({
        platform: order.platformSlug,
        targetType: order.targetType,
        input: inputVal,
        resolveShortLinks: false,
      });

      if (res.ok) {
        setCanonicalTarget(res.canonical);
        setNormalizationError("");
        void fetchPreview(res.canonical);
      } else {
        setCanonicalTarget("");
        setNormalizationError(res.message);
        setPreviewData(null);
      }
    } catch {
      // fallback
    }
  }

  async function fetchPreview(url: string) {
    const cleanPlatform = order.platformSlug.toLowerCase();
    if (!["youtube", "x", "twitter", "x-twitter", "tiktok"].includes(cleanPlatform)) {
      setPreviewData(null);
      return;
    }

    setPreviewLoading(true);
    setPreviewErrorCode(null);
    setPreviewConfirmed(false);

    try {
      const res = await fetch("/api/link-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: order.platformSlug,
          url,
          targetType: order.targetType,
        }),
      });
      const data = await res.json();
      if (data.ok && data.data) {
        setPreviewData(data.data);
        setPreviewErrorCode(null);
      } else {
        setPreviewData(null);
        setPreviewErrorCode((data.code as LinkPreviewErrorCode) || "UNAVAILABLE");
      }
    } catch {
      setPreviewData(null);
      setPreviewErrorCode("UNAVAILABLE");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newTarget.trim() || normalizationError) return;

    setSubmitting(true);
    setSubmitError("");

    try {
      const res = await fetch("/api/orders/fix-target", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          newTarget: canonicalTarget || newTarget.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        setSucceeded(true);
      } else {
        setSubmitError(data.error || "Failed to submit corrected link. Please try again.");
      }
    } catch {
      setSubmitError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (succeeded) {
    return (
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-8 text-center backdrop-blur-md">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-xl font-bold">
          ✓
        </div>
        <h2 className="text-xl font-semibold text-white">Thanks, we&apos;re delivering your order now</h2>
        <p className="mt-2 text-sm text-white/70">
          Your updated link has been received and fulfillment has automatically resumed. You do not need to do anything else.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs space-y-2">
        <div className="flex justify-between text-white/60">
          <span>Service</span>
          <span className="font-medium text-white">{order.serviceName}</span>
        </div>
        <div className="flex justify-between text-white/60">
          <span>Quantity</span>
          <span className="font-medium text-white">{order.quantity.toLocaleString()} units</span>
        </div>
        <div className="flex justify-between text-white/60">
          <span>Previous Link</span>
          <span className="font-mono text-red-300 truncate max-w-[220px]">{order.targetValue}</span>
        </div>
      </div>

      <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-4 text-xs text-amber-200/90 leading-relaxed">
        <strong>What went wrong:</strong> The link couldn&apos;t be used by our delivery system. It may have been misspelled, formatted unexpectedly, or set to private.
      </div>

      <div className="space-y-2">
        <label htmlFor="newTarget" className="block text-xs font-semibold uppercase tracking-wider text-white/70">
          Corrected Link or Username
        </label>
        <input
          id="newTarget"
          type="text"
          value={newTarget}
          onChange={(e) => {
            setNewTarget(e.target.value);
            void handleNormalize(e.target.value);
          }}
          placeholder={order.targetType === "username" ? "@username" : "https://..."}
          className="w-full rounded-xl border border-white/15 bg-black/50 px-4 py-3 text-sm text-white placeholder-white/30 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 min-h-[44px]"
          required
        />
        {normalizationError && (
          <p className="text-xs text-red-400 mt-1" role="alert">
            {normalizationError}
          </p>
        )}
      </div>

      {/* Link Preview Confirmation */}
      <LinkPreviewCard
        loading={previewLoading}
        preview={previewData}
        errorCode={previewErrorCode}
        confirmed={previewConfirmed}
        onConfirm={() => setPreviewConfirmed(true)}
        onChangeLink={() => {
          setNewTarget("");
          setCanonicalTarget("");
          setPreviewData(null);
        }}
      />

      {submitError && (
        <div className="rounded-lg border border-red-500/30 bg-red-950/40 p-3 text-xs text-red-300" role="alert">
          {submitError}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !newTarget.trim() || Boolean(normalizationError)}
        className="w-full rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold py-3 px-4 min-h-[44px] transition-colors flex items-center justify-center text-sm shadow-lg shadow-purple-950/50"
      >
        {submitting ? "Resubmitting..." : "Resubmit Link & Resume Delivery"}
      </button>
    </form>
  );
}
