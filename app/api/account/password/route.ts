import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser, createSupabaseAdminClient } from "../../../../lib/supabase/server";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Enter your current password and a new password." }, { status: 400 });
  }

  const fields = body as Record<string, unknown>;
  const currentPassword = fields.currentPassword;
  const newPassword = fields.newPassword;
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return NextResponse.json({ error: "Enter your current password and a new password." }, { status: 400 });
  }
  if (!currentPassword || newPassword.length < 6) {
    return NextResponse.json({ error: "Your new password must contain at least 6 characters." }, { status: 400 });
  }
  if (currentPassword === newPassword) {
    return NextResponse.json({ error: "Choose a new password that differs from your current password." }, { status: 400 });
  }
  if (!user.email) {
    return NextResponse.json({ error: "This account does not have an email address for password verification." }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ error: "Password changes are temporarily unavailable. Please try again later." }, { status: 500 });
  }

  const verifier = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: verified, error: verificationError } = await verifier.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });

  if (verificationError) {
    if (verificationError.code === "invalid_credentials" || verificationError.message.toLowerCase().includes("invalid login credentials")) {
      return NextResponse.json({ error: "Your current password is incorrect. Please check it and try again." }, { status: 400 });
    }
    if (verificationError.status === 429) {
      return NextResponse.json({ error: "Too many verification attempts. Please wait a few minutes and try again." }, { status: 429 });
    }
    return NextResponse.json({ error: "We couldn't verify your current password right now. Please try again shortly." }, { status: 502 });
  }

  if (verified.user?.id !== user.id) {
    return NextResponse.json({ error: "Your current password could not be verified for this account. Please sign in again." }, { status: 401 });
  }

  const { error: updateError } = await createSupabaseAdminClient().auth.admin.updateUserById(user.id, {
    password: newPassword,
  });
  if (updateError) {
    return NextResponse.json({ error: "Your current password was verified, but the new password could not be saved. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ updated: true });
}
