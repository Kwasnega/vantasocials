"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition, useState, useEffect, useRef } from "react";

export function AdminSearchInput({
  id = "customer-search",
  name = "q",
  initialValue = "",
  placeholder = "Search...",
  buttonText = "Search",
}: {
  id?: string;
  name?: string;
  initialValue?: string;
  placeholder?: string;
  buttonText?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [val, setVal] = useState(initialValue);

  // Debounce timer ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setVal(searchParams.get(name) ?? "");
  }, [searchParams, name]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  function navigate(value: string) {
    const current = new URLSearchParams(searchParams.toString());
    current.delete("page");
    current.delete("cursor");
    if (value.trim()) {
      current.set(name, value.trim());
    } else {
      current.delete(name);
    }
    startTransition(() => {
      router.push(`${pathname}?${current.toString()}`);
    });
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    navigate(val);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setVal(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Immediately navigate on clear
    if (!value.trim()) {
      navigate(value);
      return;
    }
    // Minimum 2 characters before triggering debounced search
    if (value.trim().length < 2) return;
    // 300ms debounce
    debounceRef.current = setTimeout(() => {
      navigate(value);
    }, 300);
  }

  return (
    <form className="customer-search" onSubmit={handleSearch}>
      <label htmlFor={id}>Find a record</label>
      <div style={{ opacity: isPending ? 0.7 : 1 }}>
        <span aria-hidden="true">⌕</span>
        <input
          id={id}
          name={name}
          value={val}
          onChange={handleChange}
          placeholder={placeholder}
        />
        <button type="submit" disabled={isPending}>
          {isPending ? "Searching..." : buttonText} <b>↗</b>
        </button>
      </div>
    </form>
  );
}
