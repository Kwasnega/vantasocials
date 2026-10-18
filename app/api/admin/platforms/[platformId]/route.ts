import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin/auth";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../../lib/security/rate-limit";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ platformId: string }> },
) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const rejected = await enforceAdminRateLimit(request, user.id, "platform-delete", 5);
    if (rejected) return rejected;
  } catch {
    return limiterUnavailable();
  }

  const { platformId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(platformId)) {
    return NextResponse.json({ error: "Invalid platform ID." }, { status: 400 });
  }

  const { data, error } = await createSupabaseAdminClient().rpc(
    "delete_admin_platform",
    { p_platform_id: platformId },
  );

  if (error) {
    if (
      error.code === "PGRST202" ||
      (error.code === "42883" && error.message.includes("delete_admin_platform"))
    ) {
      return NextResponse.json(
        { error: "Platform deletion is not installed in the database yet. Apply supabase/migrations/20261017000001_admin_platform_deletion.sql, then try again." },
        { status: 503 },
      );
    }
    if (error.code === "42501" || error.message.includes("UNAUTHORIZED")) {
      return NextResponse.json(
        { error: "Platform deletion database permissions are out of date. Apply the latest platform-deletion migration, then try again." },
        { status: 503 },
      );
    }
    if (error.message.includes("PLATFORM_NOT_FOUND")) {
      return NextResponse.json({ error: "Platform not found." }, { status: 404 });
    }
    if (error.message.includes("PLATFORM_HAS_ORDER_HISTORY")) {
      return NextResponse.json(
        { error: "This platform has services with order history, so it cannot be permanently deleted. The platform and its services were left unchanged." },
        { status: 409 },
      );
    }
    console.error("Admin platform deletion failed", error.message);
    return NextResponse.json(
      { error: "Unable to delete platform. No platform or service records were removed." },
      { status: 500 },
    );
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    console.error("Admin platform deletion returned an invalid result.");
    return NextResponse.json(
      { error: "Platform deletion could not be confirmed. Please refresh before trying again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ deleted: data });
}
