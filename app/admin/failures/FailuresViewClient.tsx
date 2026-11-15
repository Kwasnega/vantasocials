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
    <div>
      {/* 1. Hero Header */}
      <header className="failures-hero">
        <div>
          <p className="dashboard-kicker">ADMIN / MONITORING</p>
          <h1>Order Failures<span>.</span></h1>
          <p className="customers-intro">
            Real-time tracking of order failures by reason, platform, and provider service.
          </p>
        </div>
        <div className="failures-hero-mark" aria-hidden="true">⚠️</div>
      </header>

      {/* 2. Controls & Window Selector */}
      <div className="failures-controls">
        <div className="failures-tabs">
          {[
            { key: "24h", label: "Last 24 Hours" },
            { key: "7d", label: "Last 7 Days" },
            { key: "30d", label: "Last 30 Days" },
          ].map((w) => (
            <Link
              key={w.key}
              href={`/admin/failures?window=${w.key}`}
              prefetch={false}
              className={`failures-tab-link ${activeWindow === w.key ? "is-active" : ""}`}
            >
              {w.label}
            </Link>
          ))}
        </div>
      </div>

      {/* 3. Headline Summary KPIs */}
      <div className="failures-stats-grid">
        <article className="failures-stat-card">
          <span>Total Orders</span>
          <strong>{data.total_orders.toLocaleString()}</strong>
          <small>In this window</small>
        </article>

        <article className="failures-stat-card">
          <span>Failed Orders</span>
          <strong style={{ color: "#f87171" }}>{data.failed_orders.toLocaleString()}</strong>
          <small>Fulfillment status = FAILED</small>
        </article>

        <article className="failures-stat-card">
          <span>Failure Rate</span>
          <strong style={{ color: data.failure_rate > 10 ? "#fbbf24" : "#fff" }}>
            {data.failure_rate}%
          </strong>
          <small>Of total orders</small>
        </article>

        <article className="failures-stat-card">
          <span>Awaiting Action</span>
          <strong style={{ color: "#d883ff" }}>{data.awaiting_action.toLocaleString()}</strong>
          <small>Target fix or low balance</small>
        </article>
      </div>

      {/* 4. Spikes Panel (Alerts early on bad provider services) */}
      {data.spikes && data.spikes.length > 0 && (
        <section className="failures-spike-box">
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
            <span style={{ fontSize: "18px" }} aria-hidden="true">🚨</span>
            <h2 style={{ fontSize: "14px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.08em", color: "#f87171", margin: 0 }}>
              Provider Failure Spike Alert
            </h2>
          </div>
          <p style={{ fontSize: "12px", color: "#fca5a5", marginBottom: "14px" }}>
            The following services experienced an acute failure spike in the last 24h (&gt;2x their 7-day failure rate and &gt;15% failures with &ge;10 orders):
          </p>

          <div style={{ display: "grid", gap: "8px" }}>
            {data.spikes.map((spk) => (
              <div
                key={spk.service_id}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  padding: "12px 14px",
                  borderRadius: "10px",
                  border: "1px solid rgba(239, 68, 68, 0.25)",
                  background: "#160714",
                  fontSize: "12px",
                }}
              >
                <div>
                  <strong style={{ color: "#fff", fontSize: "14px" }}>{spk.service_name}</strong>
                  <span style={{ marginLeft: "8px", color: "#a99bb2" }}>({spk.platform_name})</span>
                  <div style={{ marginTop: "4px", display: "flex", gap: "14px", color: "#a99bb2", fontSize: "11px" }}>
                    <span>Provider ID: <code style={{ color: "#d883ff" }}>{spk.provider_service_id || "None"}</code></span>
                    <span>Primary Reason: <strong style={{ color: "#fca5a5" }}>{spk.primary_reason || "unknown"}</strong></span>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ color: "#f87171", fontWeight: "bold", fontSize: "14px" }}>{spk.rate_24h}% (24h)</span>
                    <span style={{ display: "block", color: "#796a84", fontSize: "11px" }}>vs {spk.rate_7d}% (7d)</span>
                  </div>
                  <Link
                    href={`/admin/orders?fulfillment=FAILED&service_id=${spk.service_id}&window=24h`}
                    prefetch={false}
                    className="admin-row-action"
                    style={{ background: "#dc2626", color: "#fff", border: "0", padding: "6px 12px", borderRadius: "8px", fontWeight: "bold" }}
                  >
                    View {spk.failed_24h} Orders →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 5. Breakdowns: Reasons & Platforms */}
      <div className="failures-panels-grid">
        {/* Reasons Horizontal Bar Breakdown */}
        <section className="failures-panel">
          <div className="failures-panel-heading">
            <h2>Failures by Reason</h2>
          </div>
          {data.by_reason.length === 0 ? (
            <p style={{ textAlign: "center", padding: "24px 0", color: "#796a84", fontSize: "13px" }}>No failures recorded in this window.</p>
          ) : (
            <div>
              {data.by_reason.map((r) => (
                <div key={r.reason} className="failures-bar-item">
                  <div className="failures-bar-header">
                    <Link
                      href={`/admin/orders?fulfillment=FAILED&failure_reason=${r.reason}&window=${activeWindow}`}
                      prefetch={false}
                    >
                      {r.reason}
                    </Link>
                    <span>
                      {r.count} ({r.percentage}%)
                    </span>
                  </div>
                  <div className="failures-bar-track">
                    <div
                      className="failures-bar-fill"
                      style={{ width: `${Math.min(100, Math.max(3, r.percentage))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Platforms Breakdown */}
        <section className="failures-panel">
          <div className="failures-panel-heading">
            <h2>Failures by Platform</h2>
          </div>
          {data.by_platform.length === 0 ? (
            <p style={{ textAlign: "center", padding: "24px 0", color: "#796a84", fontSize: "13px" }}>No platform activity recorded in this window.</p>
          ) : (
            <div>
              {data.by_platform.map((p) => (
                <div key={p.platform_id} className="failures-bar-item">
                  <div className="failures-bar-header">
                    <Link
                      href={`/admin/orders?fulfillment=FAILED&platform_id=${p.platform_id}&window=${activeWindow}`}
                      prefetch={false}
                    >
                      {p.platform_name}
                    </Link>
                    <span>
                      {p.failed_orders} / {p.total_orders} ({p.failure_rate}%)
                    </span>
                  </div>
                  <div className="failures-bar-track">
                    <div
                      className="failures-bar-fill"
                      style={{
                        width: `${Math.min(100, Math.max(3, p.failure_rate))}%`,
                        background: "linear-gradient(90deg, #10b981, #34d399)",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* 6. By Service Table with Minimum Volume Filter */}
      <section className="customers-panel">
        <div className="customers-panel-heading">
          <div>
            <p className="dashboard-kicker">SERVICES PERFORMANCE</p>
            <h2>Failures by Service</h2>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#c8b9d0", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={minVolumeFilter}
              onChange={(e) => setMinVolumeFilter(e.target.checked)}
              style={{ accentColor: "#d883ff" }}
            />
            <span>Hide low-volume services (&lt;10 orders)</span>
          </label>
        </div>

        {displayedServices.length === 0 ? (
          <div className="customers-empty">
            <h3>No matching services</h3>
            <p>No services match the current volume filter in this period.</p>
          </div>
        ) : (
          <div className="dashboard-table-wrap">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Platform</th>
                  <th>Provider ID</th>
                  <th style={{ textAlign: "right" }}>Orders</th>
                  <th style={{ textAlign: "right" }}>Failed</th>
                  <th style={{ textAlign: "right" }}>Failure Rate</th>
                  <th>Top Reason</th>
                  <th style={{ textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {displayedServices.map((svc) => (
                  <tr key={svc.service_id}>
                    <td>
                      <strong style={{ color: "#fff" }}>{svc.service_name}</strong>
                    </td>
                    <td>{svc.platform_name}</td>
                    <td><code style={{ color: "#d883ff" }}>{svc.provider_service_id || "—"}</code></td>
                    <td style={{ textAlign: "right" }}>{svc.total_orders}</td>
                    <td style={{ textAlign: "right", color: "#f87171", fontWeight: "bold" }}>{svc.failed_orders}</td>
                    <td style={{ textAlign: "right" }}>
                      <span
                        className="admin-status"
                        style={{
                          background: svc.failure_rate > 20 ? "rgba(239,68,68,0.2)" : svc.failure_rate > 10 ? "rgba(245,158,11,0.2)" : "rgba(255,255,255,0.1)",
                          color: svc.failure_rate > 20 ? "#fca5a5" : svc.failure_rate > 10 ? "#fde68a" : "#e2e8f0",
                        }}
                      >
                        {svc.failure_rate}%
                      </span>
                    </td>
                    <td>{svc.primary_failure_reason || "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      <Link
                        href={`/admin/orders?fulfillment=FAILED&service_id=${svc.service_id}&window=${activeWindow}`}
                        prefetch={false}
                        className="admin-row-action"
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
