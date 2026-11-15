import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin } from "../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../../lib/security/rate-limit";
import { getMinDepositSetting, validateMinDepositInput } from "../../../../../lib/settings/deposit-settings";

export async function GET() {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  const setting = await getMinDepositSetting();
  return NextResponse.json(setting);
}

export async function PATCH(request: Request) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const rejected = await enforceAdminRateLimit(request, user.id, "settings-min-deposit", [20, 20]);
    if (rejected) return rejected;
  } catch {
    return limiterUnavailable();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const rawValue = body && typeof body === "object" && "min_deposit_ghs" in body
    ? (body as Record<string, unknown>).min_deposit_ghs
    : null;

  const validation = validateMinDepositInput(rawValue);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  const now = new Date().toISOString();

  // Read previous value for audit logging
  const { data: previous, error: readError } = await db
    .from("pricing_settings")
    .select("fx_rate")
    .eq("key", "min_deposit_ghs")
    .maybeSingle();

  if (readError) {
    console.error("[min-deposit] Failed to read previous setting for audit:", readError.message);
    return NextResponse.json({ error: "Unable to load existing setting for audit." }, { status: 500 });
  }

  const oldNumeric = previous?.fx_rate != null ? Number(previous.fx_rate) : null;
  const newNumeric = validation.value;

  // Persist updated setting into pricing_settings
  const { error: upsertError } = await db
    .from("pricing_settings")
    .upsert({
      key: "min_deposit_ghs",
      fx_rate: newNumeric,
      fx_source: "MANUAL",
      updated_by: user.id,
      updated_at: now,
    });

  if (upsertError) {
    console.error("[min-deposit] Failed to update pricing_settings:", upsertError.message);
    return NextResponse.json({ error: "Failed to update minimum deposit setting." }, { status: 500 });
  }

  // Dual audit record: pricing_audit_log and admin_action_log
  const [pricingAuditResult, adminActionResult] = await Promise.all([
    db.from("pricing_audit_log").insert({
      service_id: null,
      field: "fx_rate",
      old_value: oldNumeric,
      new_value: newNumeric,
      changed_by: user.id,
    }),
    db.from("admin_action_log").insert({
      action: "APP_SETTINGS_UPDATE",
      performed_by: user.id,
      details: {
        key: "min_deposit_ghs",
        old_value: oldNumeric,
        new_value: newNumeric,
      },
      result_summary: {
        key: "min_deposit_ghs",
        value: newNumeric,
        updated_at: now,
      },
    }),
  ]);

  if (pricingAuditResult.error) {
    console.error("[min-deposit] Pricing audit log insert failed:", pricingAuditResult.error.message);
  }
  if (adminActionResult.error) {
    console.error("[min-deposit] Admin action log insert failed:", adminActionResult.error.message);
  }

  // Trigger cache revalidation
  try {
    revalidateTag("app-settings");
    revalidateTag("deposit-settings");
  } catch {
    // Best-effort in Edge/Node runtime
  }

  return NextResponse.json({
    success: true,
    minDepositGhs: newNumeric,
    formatted: validation.formatted,
    updatedAt: now,
    updatedBy: user.id,
    updatedByEmail: user.email ?? null,
  });
}
