import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin/auth";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../lib/security/rate-limit";
import { createSupabaseAdminClient } from "../../../../lib/supabase/server";

const CONFIRMATION_PHRASE = "WIPE ALL DATA";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function POST(request: Request) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const rejected = await enforceAdminRateLimit(request, user.id, "data-wipe", 2);
    if (rejected) return rejected;
  } catch {
    return limiterUnavailable();
  }

  const body: unknown = await request.json().catch(() => null);
  const confirmation = isRecord(body) ? body.confirmation : null;
  if (confirmation !== CONFIRMATION_PHRASE) {
    return NextResponse.json(
      { error: `Type "${CONFIRMATION_PHRASE}" exactly to confirm this action.` },
      { status: 400 },
    );
  }

  const { data, error } = await createSupabaseAdminClient().rpc(
    "admin_wipe_order_financial_data",
    { p_confirmation: CONFIRMATION_PHRASE },
  );

  if (error) {
    const blockedMessages: Record<string, string> = {
      WIPE_BLOCKED_ACTIVE_FULFILLMENT:
        "Wipe blocked: resolve all active or in-progress fulfillment before trying again.",
      WIPE_BLOCKED_PENDING_PAYMENT:
        "Wipe blocked: wait for all pending order payments to settle before trying again.",
      WIPE_BLOCKED_PENDING_DEPOSIT:
        "Wipe blocked: wait for all pending wallet deposits to settle before trying again.",
      WIPE_BLOCKED_ACTIVE_WEBHOOK:
        "Wipe blocked: wait for active Paystack payment notifications to finish processing before trying again.",
    };
    const blockedMessage = Object.entries(blockedMessages).find(([code]) =>
      error.message.includes(code),
    )?.[1];
    if (blockedMessage) return NextResponse.json({ error: blockedMessage }, { status: 409 });

    console.error("Admin data wipe failed", error.message);
    return NextResponse.json(
      { error: "The data wipe failed. No records were removed; please try again later." },
      { status: 500 },
    );
  }

  if (!isRecord(data) || Object.values(data).some((count) => typeof count !== "number")) {
    console.error("Admin data wipe returned an invalid result.");
    return NextResponse.json(
      { error: "The wipe result could not be confirmed. Please contact support before retrying." },
      { status: 500 },
    );
  }

  return NextResponse.json({ removed: data });
}
