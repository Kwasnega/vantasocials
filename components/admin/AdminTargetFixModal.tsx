"use client";

import React, { useState } from "react";
import { LinkPreviewCard } from "../services/LinkPreviewCard";
import type { LinkPreviewData, LinkPreviewErrorCode } from "../../lib/link-preview/types";
import { normalizeTarget } from "../../lib/targets/normalize";

interface AdminTargetFixModalProps {
  orderId: string;
  publicOrderId: string;
  currentTarget: string;
  targetType: string;
  platformSlug: string;
  onSuccess: (newCanonical: string) => void;
  onClose: () => void;
}

export function AdminTargetFixModal({
  orderId,
  publicOrderId,
  currentTarget,
  targetType,
  platformSlug,
  onSuccess,
  onClose,
}: AdminTargetFixModalProps) {
  const [newTarget, setNewTarget] = useState("");
  const [canonicalTarget, setCanonicalTarget] = useState("");
  const [reason, setReason] = useState("");
  const [normalizationError, setNormalizationError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Link preview
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<LinkPreviewData | null>(null);
  const [previewErrorCode, setPreviewErrorCode] = useState<LinkPreviewErrorCode | null>(null);
  const [previewConfirmed, setPreviewConfirmed] = useState(false);

  async function handleNormalize(val: string) {
    if (!val.trim()) {
      setCanonicalTarget("");
      setNormalizationError("");
      setPreviewData(null);
      return;
    }

    try {
      const res = await normalizeTarget({
        platform: platformSlug,
        targetType,
        input: val,
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
      // safe fallback
    }
  }

  async function fetchPreview(url: string) {
    const cleanPlatform = platformSlug.toLowerCase();
    if (!["youtube", "x", "twitter", "x-twitter", "tiktok"].includes(cleanPlatform)) {
      setPreviewData(null);
      return;
    }

    setPreviewLoading(true);
    setPreviewErrorCode(null);

    try {
      const res = await fetch("/api/link-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: platformSlug,
          url,
          targetType,
        }),
      });
      const data = await res.json();
      if (data.ok && data.data) {
        setPreviewData(data.data);
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
    setError("");

    try {
      const res = await fetch(`/api/admin/orders/${orderId}/edit-target`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newTarget: canonicalTarget || newTarget.trim(),
          reason: reason || "Admin manual target correction",
        }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        onSuccess(data.newCanonical || canonicalTarget || newTarget);
      } else {
        setError(data.error || "Failed to update target and retry.");
      }
    } catch {
      setError("Network error communicating with server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#161822] p-6 shadow-2xl text-white">
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <h2 className="text-base font-bold">Edit Target & Retry #{publicOrderId}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white/40 hover:text-white p-1 text-lg min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="text-xs space-y-1">
            <span className="text-white/60">Current Target</span>
            <div className="rounded bg-black/40 p-2 font-mono text-red-300 break-all border border-red-500/20">
              {currentTarget}
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="modalNewTarget" className="text-xs font-semibold uppercase tracking-wider text-white/70">
              New Target URL / Username
            </label>
            <input
              id="modalNewTarget"
              type="text"
              value={newTarget}
              onChange={(e) => {
                setNewTarget(e.target.value);
                void handleNormalize(e.target.value);
              }}
              placeholder="Enter corrected link or handle..."
              className="w-full rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-purple-500 focus:outline-none min-h-[44px]"
              required
            />
            {canonicalTarget && (
              <p className="text-[11px] text-emerald-400 font-mono mt-1">
                ✓ Canonical: {canonicalTarget}
              </p>
            )}
            {normalizationError && (
              <p className="text-xs text-red-400 mt-1">
                {normalizationError}
              </p>
            )}
          </div>

          {/* Optional Reason */}
          <div className="space-y-1">
            <label htmlFor="modalReason" className="text-xs font-semibold uppercase tracking-wider text-white/70">
              Reason (Audit Log)
            </label>
            <input
              id="modalReason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. User sent corrected link via support chat"
              className="w-full rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-xs text-white placeholder-white/30 focus:border-purple-500 focus:outline-none min-h-[44px]"
            />
          </div>

          {/* Link preview card */}
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

          {error && (
            <div className="rounded border border-red-500/30 bg-red-950/40 p-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg px-4 py-2 text-xs font-semibold text-white/70 hover:text-white min-h-[44px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !newTarget.trim() || Boolean(normalizationError)}
              className="rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold px-4 py-2 text-xs min-h-[44px] transition-colors"
            >
              {submitting ? "Updating & Retrying..." : "Save & Retry Fulfillment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
