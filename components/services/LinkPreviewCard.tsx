"use client";

import React from "react";
import Image from "next/image";
import type { LinkPreviewData, LinkPreviewErrorCode } from "../../lib/link-preview/types";

interface LinkPreviewCardProps {
  loading: boolean;
  preview: LinkPreviewData | null;
  errorCode: LinkPreviewErrorCode | null;
  confirmed: boolean;
  platform?: string;
  onConfirm: () => void;
  onUndoConfirm?: () => void;
  onChangeLink: () => void;
  onContinueAnyway?: () => void;
}

export function LinkPreviewCard({
  loading,
  preview,
  errorCode,
  confirmed,
  platform,
  onConfirm,
  onUndoConfirm,
  onChangeLink,
  onContinueAnyway,
}: LinkPreviewCardProps) {
  // If unsupported, rate-limited, timeout or unavailable without a warning state, show nothing silently
  if (!loading && !preview && (!errorCode || errorCode === "UNSUPPORTED" || errorCode === "RATE_LIMITED" || errorCode === "TIMEOUT" || errorCode === "UNAVAILABLE")) {
    return null;
  }

  // 1. Loading Skeleton State
  if (loading) {
    return (
      <section
        className="link-preview-card is-loading"
        aria-label="Link validation"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="preview-skeleton-layout">
          <div className="preview-skeleton-media" />
          <div className="preview-skeleton-content">
            <div className="preview-skeleton-line short" />
            <div className="preview-skeleton-line title" />
            <div className="preview-skeleton-line author" />
          </div>
        </div>
        <span className="sr-only">Validating link preview…</span>
      </section>
    );
  }

  // 2. Warning State: NOT_FOUND or PRIVATE_OR_REMOVED
  const isWarning = errorCode === "NOT_FOUND" || errorCode === "PRIVATE_OR_REMOVED";
  if (isWarning && !confirmed) {
    const isNotFound = errorCode === "NOT_FOUND";
    return (
      <section
        className="link-preview-card is-warning"
        aria-label="Link warning"
        aria-live="assertive"
      >
        <div className="preview-warning-body">
          <div className="preview-warning-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div className="preview-warning-text">
            <h4 className="preview-warning-title">
              {isNotFound ? "Post Not Found" : "Content May Be Private or Removed"}
            </h4>
            <p className="preview-warning-desc">
              {isNotFound
                ? "We couldn't locate this post. Double-check the URL to ensure it is public and correct."
                : "This post may be restricted or deleted. Automated orders on private content cannot be fulfilled."}
            </p>
          </div>
        </div>

        <div className="preview-card-actions">
          <button
            type="button"
            onClick={onChangeLink}
            className="preview-btn-primary"
          >
            Change link
          </button>
          {onContinueAnyway && (
            <button
              type="button"
              onClick={onContinueAnyway}
              className="preview-btn-secondary"
            >
              Continue anyway
            </button>
          )}
        </div>
      </section>
    );
  }

  // If preview is null and not warning/loading, return null
  if (!preview) return null;

  const providerName = preview.providerName || platform || "Social";
  const authorDisplay = preview.authorName || "Creator";

  // 3. Compact Confirmed State
  if (confirmed) {
    return (
      <section
        className="link-preview-card is-confirmed"
        aria-label="Confirmed target preview"
        aria-live="polite"
      >
        <div className="preview-confirmed-layout">
          <div className="preview-confirmed-badge" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          {preview.thumbnailUrl ? (
            <div className="preview-confirmed-thumb">
              <Image
                src={preview.thumbnailUrl}
                alt={preview.title || "Confirmed thumbnail"}
                fill
                sizes="48px"
                className="preview-thumb-img"
              />
            </div>
          ) : (
            <div className="preview-confirmed-avatar" aria-hidden="true">
              <span>{authorDisplay.slice(0, 1).toUpperCase()}</span>
            </div>
          )}

          <div className="preview-confirmed-info">
            <div className="preview-confirmed-header">
              <span className="preview-confirmed-tag">Confirmed</span>
              <span className="preview-pill">{providerName}</span>
            </div>
            <p className="preview-confirmed-title">
              {preview.title || `Post by ${authorDisplay}`}
            </p>
          </div>

          <div className="preview-confirmed-actions">
            <button
              type="button"
              onClick={onUndoConfirm || onChangeLink}
              className="preview-btn-text"
              aria-label="Change or undo confirmation"
            >
              Change
            </button>
          </div>
        </div>
      </section>
    );
  }

  // 4. Full Confirmation Required State
  const hasThumbnail = Boolean(preview.thumbnailUrl);

  return (
    <section
      className="link-preview-card is-unconfirmed"
      aria-label="Post verification"
      aria-live="polite"
    >
      <div className="preview-card-body">
        {hasThumbnail ? (
          <div className="preview-media-thumb">
            <Image
              src={preview.thumbnailUrl!}
              alt={preview.title || "Post thumbnail"}
              fill
              sizes="(max-width: 600px) 100vw, 136px"
              className="preview-thumb-img"
            />
          </div>
        ) : (
          <div className="preview-media-avatar" aria-label={`${authorDisplay}'s profile`}>
            <span className="preview-avatar-letter">
              {authorDisplay.slice(0, 1).toUpperCase()}
            </span>
            <span className="preview-avatar-mark">{providerName.slice(0, 1)}</span>
          </div>
        )}

        <div className="preview-card-details">
          <div className="preview-card-header">
            <span className="preview-pill">{providerName}</span>
            {preview.authorName && (
              <span className="preview-author-meta truncate">
                by <strong>{preview.authorName}</strong>
              </span>
            )}
          </div>

          {preview.title ? (
            <h4 className="preview-title" title={preview.title}>
              {preview.title}
            </h4>
          ) : (
            <h4 className="preview-title fallback">
              Video by {authorDisplay}
            </h4>
          )}

          <h5 className="preview-prompt-question">Is this the right post?</h5>
        </div>
      </div>

      <div className="preview-card-actions">
        <button
          type="button"
          onClick={onConfirm}
          className="preview-btn-primary"
          aria-label="Confirm this is the right post and proceed"
        >
          Yes, this is it
        </button>
        <button
          type="button"
          onClick={onChangeLink}
          className="preview-btn-text"
          aria-label="Change target link"
        >
          Change link
        </button>
      </div>
    </section>
  );
}
