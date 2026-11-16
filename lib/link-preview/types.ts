/**
 * Core types for oEmbed Link Preview system.
 */

export type LinkPreviewErrorCode =
  | "UNSUPPORTED"
  | "NOT_FOUND"
  | "PRIVATE_OR_REMOVED"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "UNAVAILABLE";

export interface LinkPreviewData {
  title: string | null;
  authorName: string;
  authorUrl?: string | null;
  thumbnailUrl?: string | null;
  providerName: string;
  fetchedAt: string;
  acknowledged_warning?: boolean;
}

export type LinkPreviewResult =
  | { ok: true; data: LinkPreviewData }
  | { ok: false; code: LinkPreviewErrorCode; message?: string };

export interface LinkPreviewAdapter {
  platform: string;
  getPreview(canonicalUrl: string): Promise<LinkPreviewResult>;
}
