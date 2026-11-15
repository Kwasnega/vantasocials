"use client";

import React from "react";
import Image from "next/image";
import type { LinkPreviewData, LinkPreviewErrorCode } from "../../lib/link-preview/types";

interface LinkPreviewCardProps {
  loading: boolean;
  preview: LinkPreviewData | null;
  errorCode: LinkPreviewErrorCode | null;
  confirmed: boolean;
  onConfirm: () => void;
  onChangeLink: () => void;
}

export function LinkPreviewCard({
  loading,
  preview,
  errorCode,
  confirmed,
  onConfirm,
  onChangeLink,
}: LinkPreviewCardProps) {
  // If unsupported, rate-limited, or unavailable without a warning state, show nothing silently
  if (!loading && !preview && (!errorCode || errorCode === "UNSUPPORTED" || errorCode === "RATE_LIMITED" || errorCode === "TIMEOUT" || errorCode === "UNAVAILABLE")) {
    return null;
  }

  return (
    <div
      className="mt-3 rounded-xl border border-white/10 bg-black/40 p-3 text-sm backdrop-blur-md transition-all duration-200"
      aria-live="polite"
    >
      {loading ? (
        <div className="flex items-center gap-3 animate-pulse">
          <div className="h-14 w-20 shrink-0 rounded-lg bg-white/10" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-3/4 rounded bg-white/10" />
            <div className="h-3 w-1/2 rounded bg-white/5" />
          </div>
        </div>
      ) : errorCode === "NOT_FOUND" ? (
        <div className="flex items-start justify-between gap-3 text-amber-300">
          <div className="flex items-center gap-2">
            <span className="text-base" aria-hidden="true">⚠️</span>
            <p className="text-xs text-amber-200/90">
              We couldn&apos;t find this post. Double-check the link.
            </p>
          </div>
          <button
            type="button"
            onClick={onChangeLink}
            className="shrink-0 text-xs text-white/70 hover:text-white underline min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            Change
          </button>
        </div>
      ) : errorCode === "PRIVATE_OR_REMOVED" ? (
        <div className="flex items-start justify-between gap-3 text-amber-300">
          <div className="flex items-center gap-2">
            <span className="text-base" aria-hidden="true">🔒</span>
            <p className="text-xs text-amber-200/90">
              This post may be private or removed. Orders on private content can&apos;t be delivered.
            </p>
          </div>
          <button
            type="button"
            onClick={onChangeLink}
            className="shrink-0 text-xs text-white/70 hover:text-white underline min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            Change
          </button>
        </div>
      ) : preview ? (
        <div className="space-y-3">
          {/* If there is no title and no thumbnail (e.g. TikTok video link), render compact card */}
          {!preview.title && !preview.thumbnailUrl ? (
            <div className="flex items-center gap-2">
              <span className="inline-block rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                {preview.providerName}
              </span>
              <p className="text-xs font-medium text-white/90">
                Video by {preview.authorName}
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              {preview.thumbnailUrl ? (
                <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/5">
                  <Image
                    src={preview.thumbnailUrl}
                    alt={preview.title || "Preview thumbnail"}
                    fill
                    sizes="96px"
                    className="object-cover"
                  />
                </div>
              ) : (
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/40 font-mono text-xs">
                  {preview.providerName}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <span className="inline-block text-[10px] uppercase tracking-wider font-semibold text-emerald-400">
                  {preview.providerName}
                </span>
                {preview.title && (
                  <h4 className="line-clamp-2 text-xs font-medium text-white/90 leading-snug">
                    {preview.title}
                  </h4>
                )}
                {preview.authorName && (
                  <p className="mt-0.5 text-[11px] text-white/50 truncate">
                    {preview.authorName}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-white/5 pt-2 text-xs">
            <span className="text-white/60">Is this the right post?</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onChangeLink}
                className="text-white/50 hover:text-white/90 px-2 py-1 min-h-[44px] flex items-center justify-center"
              >
                Change link
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className={`rounded-md px-3 py-1 font-medium min-h-[44px] flex items-center justify-center transition-colors ${
                  confirmed
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    : "bg-white/10 hover:bg-white/20 text-white"
                }`}
              >
                {confirmed ? "✓ Confirmed" : "Yes, continue"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
