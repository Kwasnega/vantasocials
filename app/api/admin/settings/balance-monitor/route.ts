import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../../lib/security/rate-limit";

const KEYS = [
  "reliablesmm_balance_warning_threshold",
  "reliablesmm_balance_critical_threshold",
  "reliablesmm_service_block_on_critical",
] as const;

type SettingsKey = (typeof KEYS)[number];

/**
 * GET /api/admin/settings/balance-monitor
 * Returns the three balance monitoring settings.
 */
export async function GET() {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("app_settings")
    .select("key,value,updated_at,updated_by")
    .in("key", KEYS as unknown as string[]);

  if (error) return NextResponse.json({ error: "Failed to load settings." }, { status: 500 });

  const settings = Object.fromEntries((data ?? []).map((r) => [r.key, r]));
  return NextResponse.json({
    warningThreshold: Number(settings["reliablesmm_balance_warning_threshold"]?.value ?? 10),
    criticalThreshold: Number(settings["reliablesmm_balance_critical_threshold"]?.value ?? 3),
    serviceBlockOnCritical: settings["reliablesmm_service_block_on_critical"]?.value === true || settings["reliablesmm_service_block_on_critical"]?.value === "true",
    raw: settings,
  });
}

/**
 * PATCH /api/admin/settings/balance-monitor
 * Body: { warningThreshold?: number, criticalThreshold?: number, serviceBlockOnCritical?: boolean }
 */
export async function PATCH(request: NextRequest) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const rejected = await enforceAdminRateLimit(request, user.id, "balance-settings", 10);
    if (rejected) return rejected;
  } catch {
    return limiterUnavailable();
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const updates: Array<{ key: SettingsKey; value: unknown }> = [];

  if ("warningThreshold" in body) {
    const val = Number(body.warningThreshold);
    if (!Number.isFinite(val) || val <= 0) {
      return NextResponse.json({ error: "warningThreshold must be a positive number." }, { status: 400 });
    }
    updates.push({ key: "reliablesmm_balance_warning_threshold", value: val });
  }

  if ("criticalThreshold" in body) {
    const val = Number(body.criticalThreshold);
    if (!Number.isFinite(val) || val < 0) {
      return NextResponse.json({ error: "criticalThreshold must be >= 0." }, { status: 400 });
    }
    updates.push({ key: "reliablesmm_balance_critical_threshold", value: val });
  }

  if ("serviceBlockOnCritical" in body) {
    if (typeof body.serviceBlockOnCritical !== "boolean") {
      return NextResponse.json({ error: "serviceBlockOnCritical must be a boolean." }, { status: 400 });
    }
    updates.push({ key: "reliablesmm_service_block_on_critical", value: body.serviceBlockOnCritical });
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  // Cross-validate warning > critical when both are present or one is changing
  const warnUpdate = updates.find((u) => u.key === "reliablesmm_balance_warning_threshold");
  const critUpdate = updates.find((u) => u.key === "reliablesmm_balance_critical_threshold");
  if (warnUpdate && critUpdate) {
    if (Number(warnUpdate.value) <= Number(critUpdate.value)) {
      return NextResponse.json({ error: "warningThreshold must be greater than criticalThreshold." }, { status: 400 });
    }
  }

  const db = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const errors: string[] = [];

  for (const update of updates) {
    const { error } = await db.from("app_settings").upsert({
      key: update.key,
      value: update.value,
      updated_at: now,
      updated_by: user.id,
    });
    if (error) errors.push(`Failed to update ${update.key}: ${error.message}`);
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: updates.map((u) => u.key) });
}
