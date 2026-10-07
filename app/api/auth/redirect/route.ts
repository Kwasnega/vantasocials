import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin/auth";

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  return value;
}

export async function GET(request: Request) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const next = safeNext(new URL(request.url).searchParams.get("next"));
  if (admin) return NextResponse.json({ redirectTo: next?.startsWith("/admin") ? next : "/admin" });
  return NextResponse.json({ redirectTo: next ?? "/account" });
}
