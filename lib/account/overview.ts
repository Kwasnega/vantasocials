import type { createSupabaseAdminClient } from "../supabase/server";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export type AccountOverviewStats = {
  totalOrders: number;
  completedOrders: number;
  processingOrders: number;
  pendingOrders: number;
  spendByCurrency: Array<{ currency: string; total: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCount(value: unknown, name: string) {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Invalid account overview value: ${name}.`);
  }
  return count;
}

export function parseAccountOverviewStats(value: unknown): AccountOverviewStats {
  if (!isRecord(value) || !Array.isArray(value.spend_by_currency)) {
    throw new Error("Invalid account overview response.");
  }

  const spendByCurrency = value.spend_by_currency.map((item) => {
    if (
      !isRecord(item)
      || typeof item.currency !== "string"
      || !/^[A-Z]{3}$/.test(item.currency)
      || typeof item.total !== "string"
      || !/^\d+(?:\.\d{1,2})?$/.test(item.total)
    ) {
      throw new Error("Invalid account overview currency total.");
    }
    return { currency: item.currency, total: item.total };
  });

  return {
    totalOrders: parseCount(value.total_orders, "total_orders"),
    completedOrders: parseCount(value.completed_orders, "completed_orders"),
    processingOrders: parseCount(value.processing_orders, "processing_orders"),
    pendingOrders: parseCount(value.pending_orders, "pending_orders"),
    spendByCurrency,
  };
}

export async function getAccountOverviewStats(db: AdminClient, userId: string) {
  const { data, error } = await db.rpc("get_customer_account_overview", { p_user_id: userId });
  if (error) throw error;
  return parseAccountOverviewStats(data);
}

export function formatSpendByCurrency(spendByCurrency: AccountOverviewStats["spendByCurrency"]) {
  if (spendByCurrency.length === 0) return "0.00 GHS";
  return spendByCurrency
    .map(({ currency, total }) => `${total} ${currency}`)
    .join(" · ");
}
