import { NextResponse } from "next/server";
import { clientIp, consumeRateLimits, rateLimited, rulesFor } from "../../../lib/security/rate-limit";
import { normalizeTargetServer as normalizeTarget } from "../../../lib/targets/normalize-server";
import { getLinkPreview } from "../../../lib/link-preview";
import { getCurrentUser } from "../../../lib/supabase/server";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    const ip = clientIp(request);

    // Rate limit: 30 requests per minute per user/IP
    const rateLimitRules = rulesFor("link-preview", user?.id ?? null, ip, [30, 60]);
    const rateLimitResult = await consumeRateLimits(rateLimitRules);
    if (!rateLimitResult.allowed) {
      return rateLimited(rateLimitResult);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, code: "UNAVAILABLE", message: "Invalid JSON body." }, { status: 400 });
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, code: "UNAVAILABLE", message: "Payload must be an object." }, { status: 400 });
    }

    const { platform, url, targetType } = body as { platform?: unknown; url?: unknown; targetType?: unknown };

    if (typeof platform !== "string" || !platform.trim()) {
      return NextResponse.json({ ok: false, code: "UNSUPPORTED", message: "Missing or invalid platform." }, { status: 400 });
    }

    if (typeof url !== "string" || !url.trim()) {
      return NextResponse.json({ ok: false, code: "NOT_FOUND", message: "Missing or invalid url." }, { status: 400 });
    }

    const cleanPlatform = platform.trim().toLowerCase();
    const cleanTargetType = typeof targetType === "string" ? targetType.trim() : "post_link";

    // 1. Run canonical normalizer first (never use raw user input)
    const normalized = await normalizeTarget({
      platform: cleanPlatform,
      targetType: cleanTargetType,
      input: url.trim(),
    });

    if (!normalized.ok) {
      return NextResponse.json({ ok: false, code: "NOT_FOUND", message: normalized.message }, { status: 200 });
    }

    // 2. Fetch preview using the canonical URL only
    const previewResult = await getLinkPreview(cleanPlatform, normalized.canonical);

    return NextResponse.json(previewResult, {
      status: 200,
      headers: {
        "Cache-Control": previewResult.ok
          ? "public, s-maxage=3600, stale-while-revalidate=600"
          : "no-store",
      },
    });
  } catch {
    return NextResponse.json({ ok: false, code: "UNAVAILABLE", message: "Internal link preview error." }, { status: 500 });
  }
}
