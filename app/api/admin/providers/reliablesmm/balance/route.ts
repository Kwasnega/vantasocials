import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/server";
import { ReliableSMMReadOnlyClient } from "../../../../../../lib/fulfillment/reliablesmm/client";
import { enforceAdminRateLimit, limiterUnavailable, acquireProviderLock, releaseProviderLock } from "../../../../../../lib/security/rate-limit";

export async function POST(request: Request) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  try { const rejected = await enforceAdminRateLimit(request, user.id, "provider-balance", 2); if (rejected) return rejected; } catch { return limiterUnavailable(); }
  const lockToken = crypto.randomUUID();
  try { if (!(await acquireProviderLock("reliablesmm:balance-refresh", lockToken))) return NextResponse.json({ error: "Provider balance refresh is already running." }, { status: 409 }); } catch { return NextResponse.json({ error: "Provider operation control is unavailable." }, { status: 503 }); }
  const db = createSupabaseAdminClient();
  try {
    const result = await new ReliableSMMReadOnlyClient().getBalance();
    const { error } = await db.from("provider_health").upsert({ provider: "reliablesmm", configured: true, balance: result.balance, balance_currency: result.currency, last_balance_check: new Date().toISOString(), balance_status: "SUCCEEDED", last_error: null, updated_at: new Date().toISOString() });
    if (error) throw error;
    await releaseProviderLock("reliablesmm:balance-refresh", lockToken);
    return NextResponse.json({ provider: "reliablesmm", balance: result.balance, currency: result.currency, status: "SUCCEEDED" });
  } catch {
    await db.from("provider_health").upsert({ provider: "reliablesmm", configured: Boolean(process.env.RELIABLESMM_API_KEY), last_balance_check: new Date().toISOString(), balance_status: "FAILED", last_error: "Balance refresh failed", updated_at: new Date().toISOString() });
    await releaseProviderLock("reliablesmm:balance-refresh", lockToken);
    return NextResponse.json({ error: "Balance refresh failed." }, { status: 502 });
  }
}
