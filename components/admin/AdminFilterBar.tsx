"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition, useState, useEffect, useRef } from "react";

export function AdminFilterBar({
  initialSearch = "",
  searchPlaceholder = "Search...",
  selects = [],
  children,
}: {
  initialSearch?: string;
  searchPlaceholder?: string;
  selects?: Array<{
    name: string;
    defaultValue: string;
    options: Array<{ value: string; label: string }>;
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

  // Debounce timer ref — used to cancel stale search triggers
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSearch(searchParams.get("q") ?? "");
    const updated: Record<string, string> = {};
    for (const s of selects) {
      updated[s.name] = searchParams.get(s.name) ?? "";
    }
    setSelectValues(updated);
  }, [searchParams, selects]);

  function buildParams(overrideSearch?: string): URLSearchParams {
    const current = new URLSearchParams(searchParams.toString());
    // Reset page/cursor on new filter
    current.delete("page");
    current.delete("cursor");
    const effectiveSearch = (overrideSearch ?? search).trim();
    if (effectiveSearch) {
      current.set("q", effectiveSearch);
    } else {
      current.delete("q");
    }
    for (const [key, val] of Object.entries(selectValues)) {
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
    // Cancel any pending debounce
    if (debounceRef.current) clearTimeout(debounceRef.current);
    navigate(buildParams());
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setSearch(value);
    // Cancel any previous pending debounce
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Immediately navigate on clear
    if (!value.trim()) {
      navigate(buildParams(value));
      return;
    }
    // Minimum 2 characters before triggering a search
    if (value.trim().length < 2) return;
    // 300ms debounce for subsequent keystrokes
    debounceRef.current = setTimeout(() => {
      navigate(buildParams(value));
    }, 300);
  }

  // Clean up timer on unmount
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  return (
    <form className="orders-filter-bar admin-order-filters" onSubmit={applyFilters}>
      <label>Filter records</label>
      <div className="orders-filter-row" style={{ opacity: isPending ? 0.7 : 1 }}>
        <input
          name="q"
          value={search}
          onChange={handleSearchChange}
          placeholder={searchPlaceholder}
        />
        {selects.map((s) => (
          <select
            key={s.name}
            name={s.name}
            value={selectValues[s.name] ?? ""}
            onChange={(e) => {
              const nextVal = e.target.value;
              setSelectValues((prev) => ({ ...prev, [s.name]: nextVal }));
            }}
          >
            {s.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ))}
        <button type="submit" disabled={isPending}>
          {isPending ? "Filtering..." : "Apply filters"} <b>↗</b>
        </button>
        {children}
      </div>
    </form>
  );
}
