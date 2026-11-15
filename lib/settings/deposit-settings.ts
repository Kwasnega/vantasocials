import { createSupabaseAdminClient } from "../supabase/server";

export const DEFAULT_MIN_DEPOSIT_GHS = 35.0;
export const MAX_DEPOSIT_GHS = 10000.0;
export const MAX_DEPOSIT_MINOR = 1000000n; // GHS 10,000.00 in minor units (pesewas)

export type MinDepositSetting = {
  minDepositGhs: number;
  updatedAt: string | null;
  updatedBy: string | null;
  updatedByEmail: string | null;
};

/**
 * Normalizes and validates a decimal input string for minimum deposit in GHS.
 * Rules:
 *  - Must be a valid positive number
 *  - At most 2 decimal places
 *  - Greater than 0
 *  - Upper bound: 10,000.00 GHS
 */
export function validateMinDepositInput(input: unknown): { valid: true; value: number; formatted: string } | { valid: false; error: string } {
  if (typeof input !== "string" && typeof input !== "number") {
    return { valid: false, error: "Minimum deposit must be provided as a number or string." };
  }
  const str = String(input).trim();
  if (!str) {
    return { valid: false, error: "Minimum deposit cannot be empty." };
  }
  // Check decimal format: positive number with at most 2 decimal digits
  if (!/^\d+(\.\d{1,2})?$/.test(str)) {
    return { valid: false, error: "Minimum deposit must be a positive number with at most 2 decimal places." };
  }
  const num = Number(str);
  if (!Number.isFinite(num) || num <= 0) {
    return { valid: false, error: "Minimum deposit must be greater than 0." };
  }
  if (num > MAX_DEPOSIT_GHS) {
    return { valid: false, error: `Minimum deposit cannot exceed GHS ${MAX_DEPOSIT_GHS.toLocaleString("en-US", { minimumFractionDigits: 2 })}.` };
  }
  return { valid: true, value: num, formatted: num.toFixed(2) };
}

/**
 * Reads the minimum deposit setting server-side from public.pricing_settings
 * with resilient fallback to DEFAULT_MIN_DEPOSIT_GHS.
 */
export async function getMinDepositSetting(): Promise<MinDepositSetting> {
  const admin = createSupabaseAdminClient();
  try {
    const { data: setting, error } = await admin
      .from("pricing_settings")
      .select("key, fx_rate, updated_at, updated_by")
      .eq("key", "min_deposit_ghs")
      .maybeSingle();

    if (error) {
      console.warn("[getMinDepositSetting] Database read error, falling back to default:", error.message);
      return {
        minDepositGhs: DEFAULT_MIN_DEPOSIT_GHS,
        updatedAt: null,
        updatedBy: null,
        updatedByEmail: null,
      };
    }

    if (!setting || setting.fx_rate == null || Number(setting.fx_rate) <= 0) {
      console.warn("[getMinDepositSetting] min_deposit_ghs row missing or invalid, using default constant:", DEFAULT_MIN_DEPOSIT_GHS);
      return {
        minDepositGhs: DEFAULT_MIN_DEPOSIT_GHS,
        updatedAt: setting?.updated_at ?? null,
        updatedBy: setting?.updated_by ?? null,
        updatedByEmail: null,
      };
    }

    let updatedByEmail: string | null = null;
    if (setting.updated_by) {
      const { data: profile } = await admin
        .from("profiles")
        .select("email")
        .eq("id", setting.updated_by)
        .maybeSingle();
      updatedByEmail = profile?.email ?? null;
    }

    return {
      minDepositGhs: Number(setting.fx_rate),
      updatedAt: setting.updated_at ?? null,
      updatedBy: setting.updated_by ?? null,
      updatedByEmail,
    };
  } catch (err) {
    console.warn("[getMinDepositSetting] Unexpected exception, falling back to default:", err instanceof Error ? err.message : err);
    return {
      minDepositGhs: DEFAULT_MIN_DEPOSIT_GHS,
      updatedAt: null,
      updatedBy: null,
      updatedByEmail: null,
    };
  }
}
