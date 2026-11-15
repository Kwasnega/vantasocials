"use client";

import React, { useState } from "react";
import Link from "next/link";
import type { FailureAnalyticsData } from "../../../lib/admin/failures/analytics";

interface FailuresViewClientProps {
  data: FailureAnalyticsData;
  activeWindow: string;
}

export function FailuresViewClient({ data, activeWindow }: FailuresViewClientProps) {
  const [minVolumeFilter, setMinVolumeFilter] = useState(true);

  const displayedServices = minVolumeFilter
    ? data.by_service.filter((s) => s.total_orders >= 10)
    : data.by_service;

  return (
    <div className="space-y-6">
      {/* 1. Window Selector & Header Meta */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Order Failures Analytics</h1>
          <p className="text-xs text-white/60">
            Real-time tracking of order failures by reason, platform, and provider service.
          </p>
        </div>

        {/* Window Tabs */}
        <div className="flex items-center rounded-xl border border-white/10 bg-black/40 p-1 text-xs">
          {[
            { key: "24h", label: "Last 24 Hours" },
            { key: "7d", label: "Last 7 Days" },
            { key: "30d", label: "Last 30 Days" },
          ].map((w) => (
            <Link
              key={w.key}
              href={`/admin/failures?window=${w.key}`}
              prefetch={false}
              className={`rounded-lg px-3 py-1.5 font-medium transition-colors min-h-[36px] flex items-center ${
                activeWindow === w.key
                  ? "bg-purple-600 text-white shadow"
                  : "text-white/60 hover:text-white"
              }`}
            >
              {w.label}
            </Link>
          ))}
        </div>
      </div>

      {/* 2. Headline Summary KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <article className="rounded-xl border border-white/10 bg-white/5 p-4">
          <span className="text-xs text-white/50 uppercase tracking-wider font-semibold">Total Orders</span>
          <p className="mt-1 text-2xl font-bold text-white">{data.total_orders.toLocaleString()}</p>
          <small className="text-[11px] text-white/40">In this window</small>
        </article>

        <article className="rounded-xl border border-white/10 bg-white/5 p-4">
          <span className="text-xs text-white/50 uppercase tracking-wider font-semibold">Failed Orders</span>
          <p className="mt-1 text-2xl font-bold text-red-400">{data.failed_orders.toLocaleString()}</p>
          <small className="text-[11px] text-white/40">Fulfillment status = FAILED</small>
        </article>

        <article className="rounded-xl border border-white/10 bg-white/5 p-4">
          <span className="text-xs text-white/50 uppercase tracking-wider font-semibold">Failure Rate</span>
          <p className={`mt-1 text-2xl font-bold ${data.failure_rate > 10 ? "text-amber-400" : "text-white"}`}>
            {data.failure_rate}%
          </p>
          <small className="text-[11px] text-white/40">Of total orders</small>
        </article>

        <article className="rounded-xl border border-white/10 bg-white/5 p-4">
          <span className="text-xs text-white/50 uppercase tracking-wider font-semibold">Awaiting Action</span>
          <p className="mt-1 text-2xl font-bold text-purple-300">{data.awaiting_action.toLocaleString()}</p>
          <small className="text-[11px] text-white/40">Target fix or low balance</small>
        </article>
      </div>

      {/* 3. Spikes Panel (Alerts early on bad provider services) */}
      {data.spikes && data.spikes.length > 0 && (
        <section className="rounded-xl border border-red-500/30 bg-red-950/20 p-5 shadow-lg">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg" aria-hidden="true">🚨</span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-red-400">
              Provider Failure Spike Alert
            </h2>
          </div>
          <p className="text-xs text-red-200/80 mb-4">
            The following services experienced an acute failure spike in the last 24h (&gt;2x their 7-day failure rate and &gt;15% failures with &ge;10 orders):
          </p>

          <div className="space-y-2">
            {data.spikes.map((spk) => (
              <div
                key={spk.service_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/20 bg-black/40 p-3 text-xs"
              >
                <div>
                  <strong className="text-white text-sm">{spk.service_name}</strong>
                  <span className="ml-2 text-white/50">({spk.platform_name})</span>
                  <div className="mt-1 flex items-center gap-3 text-white/60">
                    <span>Provider ID: <code className="text-purple-300 font-mono">{spk.provider_service_id || "None"}</code></span>
                    <span>Primary Reason: <strong className="text-red-300">{spk.primary_reason || "unknown"}</strong></span>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <span className="text-red-400 font-bold text-sm">{spk.rate_24h}% (24h)</span>
                    <span className="text-white/40 block text-[11px]">vs {spk.rate_7d}% (7d)</span>
                  </div>
                  <Link
                    href={`/admin/orders?fulfillment=FAILED&service_id=${spk.service_id}&window=24h`}
                    prefetch={false}
                    className="rounded bg-red-600/80 hover:bg-red-500 text-white px-3 py-1.5 font-medium transition-colors min-h-[36px] flex items-center"
                  >
                    View {spk.failed_24h} Orders →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 4. Breakdowns: Reasons (CSS Bars) & Platforms */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Reasons Horizontal Bar Breakdown */}
        <section className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-white mb-4">
            Failures by Reason
          </h2>
          {data.by_reason.length === 0 ? (
            <p className="text-xs text-white/40 py-4 text-center">No failures recorded in this window.</p>
          ) : (
            <div className="space-y-3">
              {data.by_reason.map((r) => (
                <div key={r.reason} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <Link
                      href={`/admin/orders?fulfillment=FAILED&failure_reason=${r.reason}&window=${activeWindow}`}
                      prefetch={false}
                      className="text-white/80 hover:text-white underline"
                    >
                      {r.reason}
                    </Link>
                    <span className="text-white/60 font-mono">
                      {r.count} ({r.percentage}%)
                    </span>
                  </div>
                  {/* CSS Horizontal Progress Bar */}
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-purple-500 transition-all duration-300"
                      style={{ width: `${Math.min(100, Math.max(2, r.percentage))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Platforms Breakdown */}
        <section className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-white mb-4">
            Failures by Platform
          </h2>
          {data.by_platform.length === 0 ? (
            <p className="text-xs text-white/40 py-4 text-center">No platform activity recorded in this window.</p>
          ) : (
            <div className="space-y-3">
              {data.by_platform.map((p) => (
                <div key={p.platform_id} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <Link
                      href={`/admin/orders?fulfillment=FAILED&platform_id=${p.platform_id}&window=${activeWindow}`}
                      prefetch={false}
                      className="text-white/80 hover:text-white underline font-medium"
                    >
                      {p.platform_name}
                    </Link>
                    <span className="text-white/60 font-mono">
                      {p.failed_orders} / {p.total_orders} ({p.failure_rate}%)
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                      style={{ width: `${Math.min(100, Math.max(2, p.failure_rate))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* 5. By Service Table with Minimum Volume Filter */}
      <section className="rounded-xl border border-white/10 bg-white/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-white">Failures by Service</h2>
            <p className="text-xs text-white/50">Sorted by failure rate descending.</p>
          </div>

          <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={minVolumeFilter}
              onChange={(e) => setMinVolumeFilter(e.target.checked)}
              className="rounded border-white/20 bg-black/40 text-purple-600 focus:ring-0"
            />
            <span>Hide low-volume services (&lt;10 orders)</span>
          </label>
        </div>

        {displayedServices.length === 0 ? (
          <div className="text-center py-8 text-xs text-white/40">
            No services match the current volume filter in this period.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-white/80">
              <thead className="border-b border-white/10 text-white/50 font-semibold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-2.5 px-3">Service</th>
                  <th className="py-2.5 px-3">Platform</th>
                  <th className="py-2.5 px-3">Provider ID</th>
                  <th className="py-2.5 px-3 text-right">Orders</th>
                  <th className="py-2.5 px-3 text-right">Failed</th>
                  <th className="py-2.5 px-3 text-right">Failure Rate</th>
                  <th className="py-2.5 px-3">Top Reason</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono">
                {displayedServices.map((svc) => (
                  <tr key={svc.service_id} className="hover:bg-white/[0.02]">
                    <td className="py-2.5 px-3 font-sans font-medium text-white max-w-[200px] truncate">
                      {svc.service_name}
                    </td>
                    <td className="py-2.5 px-3 font-sans text-white/60">{svc.platform_name}</td>
                    <td className="py-2.5 px-3 text-purple-300">{svc.provider_service_id || "—"}</td>
                    <td className="py-2.5 px-3 text-right">{svc.total_orders}</td>
                    <td className="py-2.5 px-3 text-right text-red-400 font-bold">{svc.failed_orders}</td>
                    <td className="py-2.5 px-3 text-right">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${
                          svc.failure_rate > 20
                            ? "bg-red-500/20 text-red-300"
                            : svc.failure_rate > 10
                            ? "bg-amber-500/20 text-amber-300"
                            : "bg-white/10 text-white/80"
                        }`}
                      >
                        {svc.failure_rate}%
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-sans text-white/50 text-[11px]">
                      {svc.primary_failure_reason || "—"}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <Link
                        href={`/admin/orders?fulfillment=FAILED&service_id=${svc.service_id}&window=${activeWindow}`}
                        prefetch={false}
                        className="text-purple-400 hover:text-purple-300 underline font-sans text-[11px]"
                      >
                        View Orders →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
