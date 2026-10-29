"use client";

import { useState } from "react";

type TabId = "overview" | "target-inputs" | "payments" | "fulfillment" | "ledger";

export function AdminOrderDetailTabs({
  overviewContent,
  targetInputsContent,
  paymentsContent,
  fulfillmentContent,
  ledgerContent,
  paymentsCount = 0,
  fulfillmentCount = 0,
  ledgerCount = 0,
}: {
  overviewContent: React.ReactNode;
  targetInputsContent: React.ReactNode;
  paymentsContent: React.ReactNode;
  fulfillmentContent: React.ReactNode;
  ledgerContent: React.ReactNode;
  paymentsCount?: number;
  fulfillmentCount?: number;
  ledgerCount?: number;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  const tabs: Array<{ id: TabId; label: string; count?: number }> = [
    { id: "overview", label: "Overview" },
    { id: "target-inputs", label: "Target & Inputs" },
    { id: "payments", label: "Payments", count: paymentsCount },
    { id: "fulfillment", label: "Fulfillment", count: fulfillmentCount },
    { id: "ledger", label: "Wallet Ledger", count: ledgerCount },
  ];

  return (
    <div className="admin-order-detail-tabs">
      <div
        role="tablist"
        aria-label="Order sections"
        style={{
          display: "flex",
          gap: "0.5rem",
          borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
          marginBottom: "1.5rem",
          overflowX: "auto",
        }}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              style={{
                background: "transparent",
                border: "none",
                borderBottom: isActive ? "2px solid #fff" : "2px solid transparent",
                color: isActive ? "#fff" : "rgba(255, 255, 255, 0.6)",
                padding: "0.75rem 1rem",
                fontSize: "0.875rem",
                fontWeight: isActive ? 600 : 400,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                whiteSpace: "nowrap",
                transition: "color 0.15s ease, border-color 0.15s ease",
              }}
            >
              <span>{tab.label}</span>
              {tab.count !== undefined && tab.count > 0 && (
                <span
                  style={{
                    backgroundColor: isActive ? "rgba(255, 255, 255, 0.2)" : "rgba(255, 255, 255, 0.08)",
                    fontSize: "0.75rem",
                    padding: "2px 6px",
                    borderRadius: "10px",
                  }}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        {activeTab === "overview" && overviewContent}
        {activeTab === "target-inputs" && targetInputsContent}
        {activeTab === "payments" && paymentsContent}
        {activeTab === "fulfillment" && fulfillmentContent}
        {activeTab === "ledger" && ledgerContent}
      </div>
    </div>
  );
}
