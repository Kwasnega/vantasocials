import { NextResponse } from "next/server";
import { getCurrentUser, createSupabaseAdminClient } from "../../../../lib/supabase/server";

const ACTIVE_DEPOSIT_STATUSES = ["PENDING", "INITIALIZING", "AUTHORIZED"];

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body) || body.confirm !== true) {
    return NextResponse.json({ error: "Confirm account deletion before continuing." }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  const [profileResult, walletResult, pendingDepositResult] = await Promise.all([
    db.from("profiles").select("id,email,display_name").eq("id", user.id).maybeSingle(),
    db.from("wallets").select("id,balance_minor").eq("user_id", user.id).maybeSingle(),
    db.from("wallet_deposit_payments").select("id").eq("user_id", user.id).in("status", ACTIVE_DEPOSIT_STATUSES).limit(1).maybeSingle(),
  ]);

  if (profileResult.error || walletResult.error || pendingDepositResult.error) {
    return NextResponse.json({ error: "Unable to verify account and wallet state. Nothing was changed." }, { status: 500 });
  }
  if (!profileResult.data) return NextResponse.json({ error: "Account profile was not found." }, { status: 404 });
  if (BigInt(String(walletResult.data?.balance_minor ?? "0")) > 0n) {
    return NextResponse.json({
      error: "Your VANTA Wallet still has funds. Use your balance or contact support to resolve it before deleting your account.",
    }, { status: 409 });
  }
  if (pendingDepositResult.data) {
    return NextResponse.json({
      error: "A wallet deposit is still pending. Wait for it to finish or contact support before deleting your account.",
    }, { status: 409 });
  }

  const anonymousEmail = `closed+${user.id}@account.invalid`;
  const profileUpdate = await db
    .from("profiles")
    .update({ email: anonymousEmail, display_name: null })
    .eq("id", user.id)
    .select("id")
    .maybeSingle();
  if (profileUpdate.error || !profileUpdate.data) {
    return NextResponse.json({ error: "Profile details could not be anonymized. Your account remains active." }, { status: 500 });
  }

  const authUpdate = await db.auth.admin.updateUserById(user.id, {
    email: anonymousEmail,
    email_confirm: true,
    user_metadata: {},
    ban_duration: "876000h",
  });
  if (authUpdate.error) {
    const rollback = await db
      .from("profiles")
      .update({ email: profileResult.data.email, display_name: profileResult.data.display_name })
      .eq("id", user.id);
    return NextResponse.json({
      error: rollback.error
        ? "Account closure could not be completed, and profile restoration needs support. Contact VANTA support."
        : "Account closure could not be completed. Your profile details were restored; please try again or contact support.",
    }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
