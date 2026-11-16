"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition, useState, useEffect, useRef } from "react";

export function AdminFilterBar({
  initialSearch = "",
  searchPlaceholder = "Search order ID or target...",
  selects = [],
  children,
}: {
  initialSearch?: string;
  searchPlaceholder?: string;
  selects?: Array<{
    name: string;
    label?: string;
    defaultValue: string;
    options: Array<{ value: string; label: string; title?: string }>;
  }>;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState(initialSearch);
  const [selectValues, setSelectValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of selects) {
      init[s.name] = s.defaultValue;
    }
    return init;
  });

  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSearch(searchParams.get("q") ?? "");
    const updated: Record<string, string> = {};
    for (const s of selects) {
      updated[s.name] = searchParams.get(s.name) ?? "";
    }
    setSelectValues(updated);
  }, [searchParams, selects]);

  function buildParams(overrideSearch?: string, overrides?: Record<string, string>): URLSearchParams {
    const current = new URLSearchParams(searchParams.toString());
    current.delete("page");
    current.delete("cursor");
    const effectiveSearch = (overrideSearch ?? search).trim();
    if (effectiveSearch) {
      current.set("q", effectiveSearch);
    } else {
      current.delete("q");
    }

    const merged = { ...selectValues, ...(overrides ?? {}) };
    for (const [key, val] of Object.entries(merged)) {
      if (val) {
        current.set(key, val);
      } else {
        current.delete(key);
      }
    }
    return current;
  }

  function navigate(params: URLSearchParams) {
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  function applyFilters(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    navigate(buildParams());
    setMobileSheetOpen(false);
  }

  function clearAllFilters() {
    setSearch("");
    const cleared: Record<string, string> = {};
    for (const s of selects) {
      cleared[s.name] = "";
    }
    setSelectValues(cleared);
    const params = new URLSearchParams();
    navigate(params);
    setMobileSheetOpen(false);
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      navigate(buildParams(value));
      return;
    }
    if (value.trim().length < 2) return;
    debounceRef.current = setTimeout(() => {
      navigate(buildParams(value));
    }, 300);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const hasActiveFilters = Boolean(search.trim()) || Object.values(selectValues).some(Boolean);

  return (
    <form className="orders-filter-toolbar" onSubmit={applyFilters} style={{ margin: "0 0 16px 0", width: "100%" }}>
      {/* Mobile Toggle Button */}
      <div className="mobile-filter-trigger" style={{ display: "none", marginBottom: "12px" }}>
        <button
          type="button"
          onClick={() => setMobileSheetOpen(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            minHeight: "44px",
            padding: "8px 16px",
            backgroundColor: "#2a153c",
            color: "#fff",
            border: "1px solid #4a315b",
            borderRadius: "10px",
            fontSize: "14px",
            fontWeight: 600,
            cursor: "pointer",
            width: "100%",
            justifyContent: "center",
          }}
        >
          <span>⚙ Filters {hasActiveFilters ? "• (Active)" : ""}</span>
        </button>
      </div>

      {/* Main Filter Toolbar Container (Desktop & Tablet: Wraps cleanly; Mobile: Responsive or Sheet) */}
      <div
        className={`filter-toolbar-content ${mobileSheetOpen ? "is-mobile-open" : ""}`}
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          gap: "10px",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        {/* Search Input with explicit label */}
        <div style={{ flex: "1 1 200px", minWidth: "180px", maxWidth: "340px" }}>
          <label
            style={{
              display: "block",
              fontSize: "11px",
              fontWeight: 700,
              color: "#a99bb2",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: "4px",
            }}
          >
            Search
          </label>
          <div style={{ position: "relative" }}>
            <span
              style={{
                position: "absolute",
                left: "12px",
                top: "50%",
                transform: "translateY(-50%)",
                color: "rgba(255,255,255,0.4)",
                fontSize: "14px",
                pointerEvents: "none",
              }}
            >
              ⌕
            </span>
            <input
              name="q"
              value={search}
              onChange={handleSearchChange}
              placeholder={searchPlaceholder}
              style={{
                width: "100%",
                height: "40px",
                padding: "0 12px 0 32px",
                border: "1px solid #4a315b",
                borderRadius: "8px",
                backgroundColor: "#160b22",
                color: "#fff",
                fontSize: "13px",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>

        {/* Dynamic Select Dropdowns with visible labels */}
        {selects.map((s) => {
          const fieldLabel =
            s.label ||
            (s.name === "service_id"
              ? "Service"
              : s.name === "platform_id"
              ? "Platform"
              : s.name === "payment"
              ? "Payment"
              : s.name === "fulfillment"
              ? "Fulfillment"
              : s.name === "failure_reason"
              ? "Failure Reason"
              : s.name.replace("_", " "));

          return (
            <div key={s.name} style={{ flex: "1 1 140px", minWidth: "130px", maxWidth: "260px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#a99bb2",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: "4px",
                }}
              >
                {fieldLabel}
              </label>
              <select
                name={s.name}
                value={selectValues[s.name] ?? ""}
                onChange={(e) => {
                  const nextVal = e.target.value;
                  setSelectValues((prev) => ({ ...prev, [s.name]: nextVal }));
                }}
                style={{
                  width: "100%",
                  height: "40px",
                  padding: "0 28px 0 10px",
                  border: "1px solid #4a315b",
                  borderRadius: "8px",
                  backgroundColor: "#160b22",
                  color: "#e8deed",
                  fontSize: "12px",
                  fontWeight: 500,
                  boxSizing: "border-box",
                  cursor: "pointer",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {s.options.map((opt) => (
                  <option
                    key={opt.value}
                    value={opt.value}
                    title={opt.title || opt.label}
                    style={{
                      backgroundColor: "#160b22",
                      color: "#fff",
                      maxWidth: "280px",
                    }}
                  >
                    {opt.label.length > 40 ? `${opt.label.slice(0, 38)}…` : opt.label}
                  </option>
                ))}
              </select>
            </div>
          );
        })}

        {/* Action Buttons: Apply & Clear */}
        <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
          <button
            type="submit"
            disabled={isPending}
            style={{
              height: "40px",
              padding: "0 18px",
              borderRadius: "8px",
              backgroundColor: "#d883ff",
              color: "#190b26",
              border: "none",
              fontWeight: 700,
              fontSize: "13px",
              cursor: isPending ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {isPending ? "Filtering…" : "Apply"}
          </button>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearAllFilters}
              disabled={isPending}
              style={{
                height: "40px",
                padding: "0 14px",
                borderRadius: "8px",
                backgroundColor: "rgba(255,255,255,0.08)",
                color: "#e8deed",
                border: "1px solid rgba(255,255,255,0.15)",
                fontSize: "12px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Clear
            </button>
          )}

          {children}
        </div>
      </div>
    </form>
  );
}
