import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin } from "../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../lib/supabase/server";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../lib/security/rate-limit";

export async function GET() {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  const db = createSupabaseAdminClient();
  const { data: platforms, error } = await db
    .from("platforms")
    .select("id,slug,name,logo,color,description,active")
    .order("name");

  if (error) return NextResponse.json({ error: "Unable to load platforms." }, { status: 500 });
  return NextResponse.json({ platforms });
}

export async function POST(request: Request) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const rejected = await enforceAdminRateLimit(request, user.id, "platform-mutation", [30, 30]);
    if (rejected) return rejected;
  } catch {
    return limiterUnavailable();
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = String(body.name || "").trim();
  const slug = String(body.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")).trim();
  const logo = String(body.logo || name.slice(0, 2).toUpperCase()).trim();
  const color = String(body.color || "#a947f4").trim();
  const description = String(body.description || `Growth services for ${name}`).trim();

  if (!name || name.length > 80) {
    return NextResponse.json({ error: "Platform name is required (max 80 chars)." }, { status: 400 });
  }
  if (!slug || slug.length > 80) {
    return NextResponse.json({ error: "Valid slug is required." }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  const { data: platform, error } = await db
    .from("platforms")
    .insert({
      name,
      slug,
      logo,
      color,
      description,
      active: true,
    })
    .select("id,slug,name,logo,color,description,active")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "A platform with this name or slug already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "Unable to create platform." }, { status: 500 });
  }

  try { revalidateTag("catalog"); } catch { /* best-effort revalidation */ }
  return NextResponse.json({ platform }, { status: 201 });
}
