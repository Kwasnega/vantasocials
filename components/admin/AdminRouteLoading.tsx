import React from "react";

export type AdminLoadingVariant =
  | "overview"
  | "table"
  | "detail"
  | "form";

function Placeholder({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={`admin-skeleton-placeholder ${className}`}
      style={{
        display: "block",
        backgroundColor: "var(--color-surface-subtle, rgba(255, 255, 255, 0.06))",
        borderRadius: "4px",
        animation: "adminPulse 1.5s ease-in-out infinite",
        ...style,
      }}
    />
  );
}

export function AdminRouteLoading({
  title = "Loading...",
  variant = "overview",
}: {
  title?: string;
  variant?: AdminLoadingVariant;
}) {
  return (
    <div
      className="admin-route-loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{ padding: "1.5rem", maxWidth: "1200px" }}
    >
      <style>{`
        @keyframes adminPulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
      `}</style>
      
      {/* Header skeleton */}
      <div style={{ marginBottom: "2rem" }}>
        <Placeholder style={{ width: "120px", height: "14px", marginBottom: "8px" }} />
        <Placeholder style={{ width: "240px", height: "32px", marginBottom: "8px" }} />
        <Placeholder style={{ width: "360px", height: "16px" }} />
      </div>

      {variant === "overview" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "1.25rem" }}>
                <Placeholder style={{ width: "80px", height: "14px", marginBottom: "12px" }} />
                <Placeholder style={{ width: "120px", height: "28px" }} />
              </div>
            ))}
          </div>
          <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "1.25rem" }}>
            <Placeholder style={{ width: "160px", height: "20px", marginBottom: "16px" }} />
            {Array.from({ length: 5 }).map((_, i) => (
              <Placeholder key={i} style={{ width: "100%", height: "40px", marginBottom: "8px" }} />
            ))}
          </div>
        </>
      )}

      {variant === "table" && (
        <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "1.25rem" }}>
          <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
            <Placeholder style={{ width: "240px", height: "36px" }} />
            <Placeholder style={{ width: "120px", height: "36px" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <Placeholder style={{ width: "100%", height: "32px", marginBottom: "4px" }} />
            {Array.from({ length: 8 }).map((_, i) => (
              <Placeholder key={i} style={{ width: "100%", height: "48px" }} />
            ))}
          </div>
        </div>
      )}

      {variant === "detail" && (
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1.5rem" }}>
          <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "1.5rem" }}>
            <Placeholder style={{ width: "180px", height: "24px", marginBottom: "16px" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <Placeholder key={i} style={{ width: "100%", height: "36px" }} />
              ))}
            </div>
          </div>
          <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "1.5rem" }}>
            <Placeholder style={{ width: "140px", height: "20px", marginBottom: "16px" }} />
            <Placeholder style={{ width: "100%", height: "80px", marginBottom: "12px" }} />
            <Placeholder style={{ width: "100%", height: "40px" }} />
          </div>
        </div>
      )}

      {variant === "form" && (
        <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "1.5rem", maxWidth: "600px" }}>
          <Placeholder style={{ width: "160px", height: "20px", marginBottom: "16px" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <Placeholder style={{ width: "100px", height: "14px", marginBottom: "6px" }} />
                <Placeholder style={{ width: "100%", height: "38px" }} />
              </div>
            ))}
            <Placeholder style={{ width: "120px", height: "40px", marginTop: "8px" }} />
          </div>
        </div>
      )}
    </div>
  );
}
