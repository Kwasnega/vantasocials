import { createSupabaseAdminClient } from "../supabase/server";
export {
  DEFAULT_MIN_DEPOSIT_GHS,
  MAX_DEPOSIT_GHS,
  MAX_DEPOSIT_MINOR,
  validateMinDepositInput,
  type MinDepositSetting,
} from "./deposit-validation";
import { DEFAULT_MIN_DEPOSIT_GHS, type MinDepositSetting } from "./deposit-validation";

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
