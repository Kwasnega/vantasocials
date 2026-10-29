"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Admin route error:", error);
  }, [error]);

  return (
    <div
      role="alert"
      className="admin-error-boundary"
      style={{
        padding: "2rem",
        maxWidth: "600px",
        margin: "2rem auto",
        backgroundColor: "var(--color-surface, rgba(255, 255, 255, 0.03))",
        border: "1px solid rgba(239, 68, 68, 0.2)",
        borderRadius: "8px",
        textAlign: "center",
      }}
    >
      <p
        style={{
          fontSize: "0.75rem",
          fontWeight: 700,
          letterSpacing: "0.1em",
          color: "rgba(239, 68, 68, 0.9)",
          marginBottom: "0.5rem",
        }}
      >
        ADMIN ERROR
      </p>
      <h2 style={{ fontSize: "1.25rem", marginBottom: "0.75rem" }}>
        Unable to load this admin view
      </h2>
      <p style={{ color: "rgba(255, 255, 255, 0.6)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        {error.message || "An unexpected error occurred while loading admin data."}
      </p>
      <div style={{ display: "flex", gap: "1rem", justifyContent: "center" }}>
        <button
          onClick={() => reset()}
          style={{
            padding: "0.5rem 1rem",
            backgroundColor: "white",
            color: "black",
            fontWeight: 600,
            borderRadius: "4px",
            border: "none",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
        <Link
          href="/admin"
          style={{
            padding: "0.5rem 1rem",
            backgroundColor: "transparent",
            color: "white",
            borderRadius: "4px",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          Return to Overview
        </Link>
      </div>
    </div>
  );
}
